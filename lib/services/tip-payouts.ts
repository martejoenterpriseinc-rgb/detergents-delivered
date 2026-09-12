import { tipRefundRequestHold } from "./tip-refunds";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import { tipPayoutInput, tipAccounting } from "@/lib/domain/tip-accounting";
import {
  tipAccountingSource as source,
  observeTipRefunds as observe,
} from "./tip-accounting-source";
import { tipRefundTaxAllocations } from "./tip-refund-tax";
const fail = () =>
  new AccountError("Tip accounting requires verified payment evidence.", 409);
import { canonicalJson } from "@/lib/commerce/domain";
import { financeAccess } from "./finance";
export async function readTipAccounting(actor: string, tipId: string) {
  await financeAccess(prisma, actor);
  const { tip, driver } = await source(prisma, tipId);
  const observation = await observe(tip);
  const entries = await prisma.tipPayoutEntry.findMany({
    where: { tipId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const refundRequests = await prisma.tipRefundRequest.findMany({
    where: { tipId },
    orderBy: { createdAt: "desc" },
    take: 101,
  });
  const refundHold = tipRefundRequestHold(refundRequests, observation.refunds);
  const accounting = tipAccounting(
    tip.amountCents,
    tip.totalCents!,
    observation.refunds,
    entries,
    await tipRefundTaxAllocations(prisma, tip),
  );
  return {
    tipId,
    driver,
    amountCents: tip.amountCents,
    refundSubmissionEnabled:
      process.env.DD_TIP_REFUNDS_ENABLED === "true" &&
      (!tip.livemode || process.env.DD_LIVE_TIP_REFUNDS_ACCEPTED === "true"),
    checkedAt: new Date().toISOString(),
    disputed: observation.disputed,
    ...accounting,
    review: accounting.review || refundHold,
    payableCents: refundHold ? 0 : accounting.payableCents,
    refundRequests: refundRequests.map((r) => ({
      id: r.id,
      state: r.state,
      amountCents: r.amountCents,
      providerRefundId: r.providerRefundId,
      lastError: r.lastError,
    })),
    entries,
    refunds: observation.refunds.map((r) => ({
      id: r.id,
      state: r.status,
      amountCents: r.amountCents,
    })),
  };
}
export async function recordTipPayout(actor: string, raw: unknown) {
  const data = tipPayoutInput.parse(raw);
  await financeAccess(prisma, actor, true);
  const hash = createHash("sha256").update(canonicalJson(data)).digest("hex");
  const id =
    "tip_payout_" +
    createHash("sha256")
      .update(actor + ":" + data.requestKey)
      .digest("hex");
  const previous = await prisma.tipPayoutEntry.findUnique({ where: { id } });
  if (previous) {
    if (previous.requestHash !== hash)
      throw new AccountError("Request key was already used for another transfer.", 409);
    return { id: previous.id };
  }
  const original = await source(prisma, data.tipId);
  const observation = await observe(original.tip);
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id = ${data.tipId} FOR UPDATE`;
    const retry = await tx.tipPayoutEntry.findUnique({ where: { id } });
    if (retry) {
      if (retry.requestHash !== hash)
        throw new AccountError("Request key was already used.", 409);
      return { id };
    }
    const current = await source(tx, data.tipId);
    if (
      current.tip.updatedAt.getTime() !== original.tip.updatedAt.getTime() ||
      current.driver !== original.driver
    )
      throw fail();
    if (data.paidOn < businessDate(current.tip.paidAt!))
      throw new AccountError("Transfer date precedes the tip payment.", 409);
    const entries = await tx.tipPayoutEntry.findMany({ where: { tipId: data.tipId } });
    if (entries.some((entry) => entry.reference === data.reference))
      throw new AccountError(
        "This receipt reference is already recorded for the tip.",
        409,
      );
    const accounting = tipAccounting(
      current.tip.amountCents,
      current.tip.totalCents!,
      observation.refunds,
      entries,
      await tipRefundTaxAllocations(tx, current.tip),
    );
    if (data.reversalOfId) {
      const parent = entries.find(
        (e) => e.id === data.reversalOfId && e.kind === "PAYMENT",
      );
      if (
        !parent ||
        parent.amountCents !== data.amountCents ||
        data.paidOn < parent.paidOn ||
        entries.some((e) => e.reversalOfId === parent.id)
      )
        throw new AccountError(
          "Choose an unreversed transfer and its exact amount.",
          409,
        );
    } else if (
      tipRefundRequestHold(
        await tx.tipRefundRequest.findMany({ where: { tipId: data.tipId }, take: 101 }),
        observation.refunds,
      ) ||
      observation.disputed ||
      accounting.review ||
      data.amountCents > accounting.payableCents
    )
      throw new AccountError(
        "Transfer exceeds the verified amount payable, or the tip needs refund/dispute review.",
        409,
      );
    const entry = {
      id,
      tipId: data.tipId,
      driverUserId: current.driver,
      kind: data.reversalOfId ? "REVERSAL" : "PAYMENT",
      amountCents: data.amountCents,
      reference: data.reference,
      paidOn: data.paidOn,
      reason: data.reason,
      requestHash: hash,
      reversalOfId: data.reversalOfId ?? null,
      actorUserId: actor,
    };
    await tx.tipPayoutEntry.create({ data: entry });
    await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "TipPayoutEntry",
        entityId: id,
        action: "delivery.tip.payout.recorded",
        afterJson: JSON.parse(
          JSON.stringify({
            ...entry,
            source: "staff-confirmed-transfer",
            refundObservation: observation,
            observedAt: new Date().toISOString(),
          }),
        ),
      },
    });
    return { id };
  });
}
