import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
import { readTaxCorrection } from "@/lib/commerce/refund-tax-correction";
import { financeAccess } from "./finance";
const fail = () =>
  new AccountError(
    "Verified refund compensation and original tax evidence are required.",
    409,
  );
export async function refundCorrectionSource(tx: Prisma.TransactionClient, id: string) {
  const a = await tx.refundAdjustment.findUnique({
    where: { id },
    include: {
      request: {
        include: { adjustments: { include: { taxEvidence: true } }, events: true },
      },
    },
  });
  if (
    !a ||
    a.kind !== "COMPENSATION" ||
    !["FAILED", "CANCELED"].includes(a.request.status) ||
    !a.failureBalanceTransactionId ||
    !a.providerRefundId ||
    a.providerRefundId !== a.request.providerRefundId ||
    !a.request.events.some((e) => e.verifiedAt && e.status === a.request.status)
  )
    throw fail();
  const original = a.request.adjustments.find((x) => x.kind === "SETTLEMENT"),
    e = original?.taxEvidence;
  if (
    !original ||
    !e ||
    original.providerRefundId !== a.providerRefundId ||
    (["cashCents", "netCents", "taxCents", "rewardCents"] as const).some(
      (k) => original[k] !== -a[k],
    ) ||
    e.taxCents !== original.taxCents ||
    e.providerAccountId !== a.request.providerAccountId ||
    e.livemode !== a.request.livemode ||
    e.currency !== "USD" ||
    a.currency !== "USD"
  )
    throw fail();
  return {
    orderId: a.request.orderId,
    requestId: a.requestId,
    settlementId: original.id,
    compensationId: id,
    failureBalanceTransactionId: a.failureBalanceTransactionId,
    binding: {
      compensationId: id,
      accountId: e.providerAccountId,
      live: e.livemode,
      originalTaxTransactionId: e.originalTaxTransactionId,
      refundTaxTransactionId: e.refundTaxTransactionId,
      cashCents: original.cashCents,
      taxCents: original.taxCents,
    },
  };
}
const evidence = z
  .object({
    source: z.unknown(),
    correctionTaxTransactionId: z.string().regex(/^tax_[A-Za-z0-9]+$/),
    refundTaxTransactionId: z.string(),
    originalTaxTransactionId: z.string(),
    cashCents: z.number().int().positive(),
    taxCents: z.number().int().nonnegative(),
    postedAt: z.number().int().positive(),
  })
  .strict();
export async function verifiedRefundTaxCorrection(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const rows = await tx.auditLog.findMany({
    where: {
      entityType: "RefundAdjustment",
      entityId: id,
      action: "refund.tax-correction.verified",
    },
    take: 2,
  });
  if (!rows.length) return null;
  const p = evidence.safeParse(rows[0].afterJson),
    s = await refundCorrectionSource(tx, id);
  if (
    rows.length !== 1 ||
    !rows[0].actorUserId ||
    !p.success ||
    canonicalJson(p.data.source) !== canonicalJson(s) ||
    p.data.refundTaxTransactionId !== s.binding.refundTaxTransactionId ||
    p.data.originalTaxTransactionId !== s.binding.originalTaxTransactionId ||
    p.data.cashCents !== s.binding.cashCents ||
    p.data.taxCents !== s.binding.taxCents
  )
    throw fail();
  return { id: rows[0].id, ...p.data };
}
export async function matchRefundTaxCorrection(actor: string, raw: unknown) {
  const d = z
    .object({
      adjustmentId: z.string().min(1).max(100),
      correctionTaxTransactionId: z
        .string()
        .regex(/^tax_[A-Za-z0-9]+$/)
        .max(100),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const s = await refundCorrectionSource(prisma, d.adjustmentId),
    observed = await readTaxCorrection(s.binding, d.correctionTaxTransactionId);
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${s.orderId} FOR UPDATE`;
    if (
      canonicalJson(await refundCorrectionSource(tx, d.adjustmentId)) !== canonicalJson(s)
    )
      throw fail();
    const previous = await verifiedRefundTaxCorrection(tx, d.adjustmentId);
    if (previous) {
      if (previous.correctionTaxTransactionId !== observed.correctionTaxTransactionId)
        throw fail();
      return { matched: true, id: previous.id };
    }
    // A provider correction may satisfy only one compensation in this account/mode.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(613279108)`;
    const used = await tx.auditLog.findFirst({
      where: {
        action: "refund.tax-correction.verified",
        AND: [
          {
            afterJson: {
              path: ["correctionTaxTransactionId"],
              equals: observed.correctionTaxTransactionId,
            },
          },
          {
            afterJson: {
              path: ["source", "binding", "accountId"],
              equals: s.binding.accountId,
            },
          },
          { afterJson: { path: ["source", "binding", "live"], equals: s.binding.live } },
        ],
      },
    });
    if (used) throw fail();
    const saved = await tx.auditLog.create({
      data: {
        actorUserId: actor,
        entityType: "RefundAdjustment",
        entityId: d.adjustmentId,
        action: "refund.tax-correction.verified",
        afterJson: JSON.parse(JSON.stringify({ source: s, ...observed })),
      },
    });
    return { matched: true, id: saved.id };
  });
}
