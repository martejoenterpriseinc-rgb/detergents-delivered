import { tipAccounting } from "@/lib/domain/tip-accounting";
import { createHash } from "node:crypto";
import type { DeliveryTip, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
import { readRefundTaxEvidence } from "@/lib/commerce/tax-report";
import { financeAccess } from "./finance";
import { tipAccountingSource, observeTipRefunds } from "./tip-accounting-source";
const action = "delivery.tip.refund-tax.matched";
const cents = z.number().int().nonnegative().max(100000);
const schema = z
  .object({
    tipId: z.string(),
    providerRefundId: z.string().regex(/^re_[A-Za-z0-9]+$/),
    accountId: z.string(),
    livemode: z.boolean(),
    paymentIntentId: z.string(),
    sessionId: z.string(),
    currency: z.literal("USD"),
    cashCents: cents,
    taxCents: cents,
    originalTaxTransactionId: z.string().regex(/^tax_[A-Za-z0-9]+$/),
    refundTaxTransactionId: z.string().regex(/^tax_[A-Za-z0-9]+$/),
    reportRunId: z.string().regex(/^frr_[A-Za-z0-9]+$/),
    fileId: z.string().regex(/^file_[A-Za-z0-9]+$/),
    reportHash: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.literal("stripe-report-api"),
  })
  .strict();
const evidenceId = (tipId: string, refundId: string) =>
  "tip_tax_" +
  createHash("sha256")
    .update(tipId + ":" + refundId)
    .digest("hex");
const fail = () => new AccountError("Tip refund tax evidence requires review.", 409);
export async function tipRefundTaxAllocations(
  tx: Prisma.TransactionClient,
  tip: DeliveryTip,
) {
  const rows = await tx.auditLog.findMany({
    where: { entityType: "DeliveryTip", entityId: tip.id, action },
    take: 101,
  });
  if (rows.length > 100) throw fail();
  const transactions = new Set<string>();
  const originalIds = new Set<string>();
  return rows.map((row) => {
    const parsed = schema.safeParse(row.afterJson);
    if (!parsed.success) throw fail();
    const a = parsed.data;
    if (
      row.id !== evidenceId(tip.id, a.providerRefundId) ||
      !row.actorUserId ||
      a.tipId !== tip.id ||
      a.accountId !== tip.stripeAccountId ||
      a.livemode !== tip.livemode ||
      a.paymentIntentId !== tip.paymentIntentId ||
      a.sessionId !== tip.stripeSessionId ||
      a.cashCents <= 0 ||
      a.cashCents > tip.totalCents! ||
      a.taxCents > a.cashCents ||
      a.taxCents > tip.taxCents! ||
      a.cashCents - a.taxCents > tip.amountCents ||
      transactions.has(a.refundTaxTransactionId)
    )
      throw fail();
    transactions.add(a.refundTaxTransactionId);
    originalIds.add(a.originalTaxTransactionId);
    if (originalIds.size > 1) throw fail();
    return a;
  });
}
export async function matchTipRefundTax(actor: string, raw: unknown) {
  const input = z
    .object({
      tipId: z.string().min(1).max(100),
      providerRefundId: z
        .string()
        .regex(/^re_[A-Za-z0-9]+$/)
        .max(100),
      reportRunId: z
        .string()
        .regex(/^frr_[A-Za-z0-9]+$/)
        .max(100),
      taxCents: cents,
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const before = await tipAccountingSource(prisma, input.tipId);
  const observed = await observeTipRefunds(before.tip);
  const refund = observed.refunds.find((r) => r.id === input.providerRefundId);
  if (
    !refund ||
    refund.status !== "succeeded" ||
    !refund.balanceTransactionId ||
    observed.disputed ||
    input.taxCents > before.tip.taxCents! ||
    input.taxCents > refund.amountCents ||
    refund.amountCents - input.taxCents > before.tip.amountCents
  )
    throw fail();
  const report = await readRefundTaxEvidence(input.reportRunId, {
    accountId: before.tip.stripeAccountId,
    live: before.tip.livemode,
    paymentIntentId: before.tip.paymentIntentId!,
    sessionId: before.tip.stripeSessionId!,
    providerRefundId: refund.id,
    saleTotalCents: before.tip.totalCents!,
    saleTaxCents: before.tip.taxCents!,
    refundCents: refund.amountCents,
    refundTaxCents: input.taxCents,
    currency: "USD",
  });
  const evidence = schema.parse({
    ...report,
    tipId: input.tipId,
    providerRefundId: refund.id,
    accountId: before.tip.stripeAccountId,
    livemode: before.tip.livemode,
    paymentIntentId: before.tip.paymentIntentId,
    sessionId: before.tip.stripeSessionId,
    currency: "USD",
    cashCents: refund.amountCents,
    source: "stripe-report-api",
  });
  if (evidence.taxCents !== input.taxCents) throw fail();
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id=${input.tipId} FOR UPDATE`;
    const current = await tipAccountingSource(tx, input.tipId);
    if (canonicalJson(current) !== canonicalJson(before)) throw fail();
    const existing = await tipRefundTaxAllocations(tx, current.tip);
    const prior = existing.find((e) => e.providerRefundId === refund.id);
    if (prior) {
      if (
        prior.cashCents !== evidence.cashCents ||
        prior.taxCents !== evidence.taxCents ||
        prior.originalTaxTransactionId !== evidence.originalTaxTransactionId ||
        prior.refundTaxTransactionId !== evidence.refundTaxTransactionId
      )
        throw fail();
      return { matched: true, id: evidenceId(input.tipId, refund.id) };
    }
    if (
      existing.length >= 100 ||
      existing.some(
        (e) =>
          e.refundTaxTransactionId === evidence.refundTaxTransactionId ||
          e.originalTaxTransactionId !== evidence.originalTaxTransactionId,
      )
    )
      throw fail();
    try {
      tipAccounting(
        current.tip.amountCents,
        current.tip.totalCents!,
        observed.refunds,
        [],
        [...existing, evidence],
      );
    } catch {
      throw fail();
    }
    const id = evidenceId(input.tipId, refund.id);
    await tx.auditLog.create({
      data: {
        id,
        actorUserId: actor,
        action,
        entityType: "DeliveryTip",
        entityId: input.tipId,
        afterJson: evidence as Prisma.InputJsonValue,
      },
    });
    return { matched: true, id };
  });
}

/** Confirm a positive tax adjustment after a previously settled tip refund fails. */
export async function matchTipRefundTaxCorrection(actor: string, raw: unknown) {
  const d = z
    .object({
      tipId: z.string().min(1).max(100),
      providerRefundId: z
        .string()
        .regex(/^re_[A-Za-z0-9]+$/)
        .max(100),
      correctionTaxTransactionId: z
        .string()
        .regex(/^tax_[A-Za-z0-9]+$/)
        .max(100),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  await financeAccess(prisma, actor, true);
  const before = await tipAccountingSource(prisma, d.tipId),
    observed = await observeTipRefunds(before.tip),
    r = observed.refunds.find((v) => v.id === d.providerRefundId),
    allocations = await tipRefundTaxAllocations(prisma, before.tip),
    a = allocations.find((v) => v.providerRefundId === d.providerRefundId);
  if (
    !r ||
    !a ||
    !["failed", "canceled"].includes(r.status) ||
    !r.failureBalanceTransactionId ||
    observed.disputed ||
    a.cashCents !== r.amountCents
  )
    throw fail();
  const { readTaxCorrection } = await import("@/lib/commerce/refund-tax-correction");
  const binding = {
    compensationId: before.tip.id + ":" + r.id,
    accountId: before.tip.stripeAccountId,
    live: before.tip.livemode,
    originalTaxTransactionId: a.originalTaxTransactionId,
    refundTaxTransactionId: a.refundTaxTransactionId,
    cashCents: a.cashCents,
    taxCents: a.taxCents,
  };
  const correction = await readTaxCorrection(binding, d.correctionTaxTransactionId);
  return prisma.$transaction(async (tx) => {
    await financeAccess(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "DeliveryTip" WHERE id=${d.tipId} FOR UPDATE`;
    if (
      canonicalJson(await tipAccountingSource(tx, d.tipId)) !== canonicalJson(before) ||
      canonicalJson(await tipRefundTaxAllocations(tx, before.tip)) !==
        canonicalJson(allocations)
    )
      throw fail();
    const id =
        "tip_tax_correction_" +
        createHash("sha256").update(binding.compensationId).digest("hex"),
      value = { binding, ...correction };
    const previous = await tx.auditLog.findUnique({ where: { id } });
    if (previous) {
      if (canonicalJson(previous.afterJson) !== canonicalJson(value)) throw fail();
      return { matched: true, id };
    }
    await tx.auditLog.create({
      data: {
        id,
        actorUserId: actor,
        entityType: "DeliveryTip",
        entityId: d.tipId,
        action: "delivery.tip.refund-tax-correction.verified",
        afterJson: value,
      },
    });
    return { matched: true, id };
  });
}
export async function assertTipTaxCorrections(
  tx: Prisma.TransactionClient,
  tip: DeliveryTip,
  refunds: Awaited<ReturnType<typeof observeTipRefunds>>["refunds"],
  allocations: Awaited<ReturnType<typeof tipRefundTaxAllocations>>,
) {
  for (const r of refunds) {
    const a = allocations.find((v) => v.providerRefundId === r.id);
    if (!a || !["failed", "canceled"].includes(r.status)) continue;
    const id =
        "tip_tax_correction_" +
        createHash("sha256")
          .update(tip.id + ":" + r.id)
          .digest("hex"),
      row = await tx.auditLog.findUnique({ where: { id } });
    const binding = {
      compensationId: tip.id + ":" + r.id,
      accountId: tip.stripeAccountId,
      live: tip.livemode,
      originalTaxTransactionId: a.originalTaxTransactionId,
      refundTaxTransactionId: a.refundTaxTransactionId,
      cashCents: a.cashCents,
      taxCents: a.taxCents,
    };
    const proof = z
      .object({
        binding: z.unknown(),
        correctionTaxTransactionId: z.string().regex(/^tax_[A-Za-z0-9]+$/),
        cashCents: z.number(),
        taxCents: z.number(),
        refundTaxTransactionId: z.string(),
        originalTaxTransactionId: z.string(),
      })
      .safeParse(row?.afterJson);
    if (
      !r.failureBalanceTransactionId ||
      !row?.actorUserId ||
      row.entityId !== tip.id ||
      row.action !== "delivery.tip.refund-tax-correction.verified" ||
      !proof.success ||
      canonicalJson(proof.data.binding) !== canonicalJson(binding) ||
      proof.data.cashCents !== a.cashCents ||
      proof.data.taxCents !== a.taxCents ||
      proof.data.refundTaxTransactionId !== a.refundTaxTransactionId ||
      proof.data.originalTaxTransactionId !== a.originalTaxTransactionId
    )
      throw new AccountError(
        "Verify the failed tip refund's tax correction before posting its accounting adjustment.",
        409,
      );
  }
}
