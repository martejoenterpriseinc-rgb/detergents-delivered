import type { CheckoutAttempt, Prisma } from "@prisma/client";
import { z } from "zod";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
const cents = z.number().int().nonnegative();
const evidenceSchema = z.object({
  taxTransactionId: z.string().min(1),
  accountId: z.string().min(1),
  livemode: z.boolean(),
  reference: z.string(),
  postedAt: z.number().int(),
  taxLines: z
    .array(z.object({ variantId: z.string().min(1), netCents: cents, taxCents: cents }))
    .min(1)
    .max(30),
});
const fail = () =>
  new AccountError(
    "Manual receipt, payment and tax evidence require review before accounting export.",
    409,
  );
/** Read original settlement evidence; never infer receipt confirmation from an order status. */
export async function verifiedManualSaleEvidence(
  tx: Prisma.TransactionClient,
  checkout: CheckoutAttempt,
  amountCents: number,
  taxCents: number,
) {
  const r = await tx.manualCheckoutSettlement.findUnique({
    where: { checkoutId: checkout.id },
  });
  if (
    !r ||
    !checkout.orderId ||
    !["CASH", "ZELLE"].includes(checkout.paymentMethod) ||
    !["PAID", "REFUNDED"].includes(checkout.state) ||
    checkout.stripeSessionId ||
    r.state !== "SETTLED" ||
    r.method !== checkout.paymentMethod ||
    r.currency !== "USD" ||
    r.amountCents !== amountCents ||
    r.accountId !== checkout.stripeAccountId ||
    r.livemode !== checkout.livemode ||
    !r.taxTransactionId
  )
    throw fail();
  const evidence = evidenceSchema.safeParse(r.taxEvidence);
  if (!evidence.success) throw fail();
  const e = evidence.data;
  if (
    e.taxTransactionId !== r.taxTransactionId ||
    e.accountId !== r.accountId ||
    e.livemode !== r.livemode ||
    e.reference !== `dd-manual:${r.id}` ||
    e.postedAt !== Math.floor(r.receivedAt.getTime() / 1000) ||
    new Set(e.taxLines.map((l) => l.variantId)).size !== e.taxLines.length ||
    e.taxLines.reduce((n, l) => n + l.taxCents, 0) !== taxCents ||
    e.taxLines.reduce((n, l) => n + l.netCents + l.taxCents, 0) !== amountCents
  )
    throw fail();
  const audits = await tx.auditLog.findMany({
    where: {
      entityType: "ManualCheckoutSettlement",
      entityId: r.id,
      action: { in: ["manual-payment.received", "manual-payment.settled"] },
    },
    take: 3,
  });
  const received = audits.filter((a) => a.action === "manual-payment.received");
  const settled = audits.filter((a) => a.action === "manual-payment.settled");
  const receiptProof = z
    .object({
      checkoutId: z.string(),
      amountCents: cents,
      reference: z.string(),
      receivedAt: z.string().datetime(),
      approvalId: z.string(),
      approvalVersion: z.number().int(),
      method: z.string(),
      reason: z.string(),
    })
    .safeParse(received[0]?.afterJson);
  if (
    received.length !== 1 ||
    settled.length !== 1 ||
    !receiptProof.success ||
    received[0].actorUserId !== r.actorUserId
  )
    throw fail();
  const p = receiptProof.data;
  if (
    p.checkoutId !== checkout.id ||
    p.amountCents !== amountCents ||
    p.reference !== r.reference ||
    new Date(p.receivedAt).getTime() !== r.receivedAt.getTime() ||
    p.approvalId !== r.approvalId ||
    p.approvalVersion !== r.approvalVersion ||
    p.method !== r.method ||
    p.reason !== r.reason
  )
    throw fail();
  const record = {
    manualSettlementId: r.id,
    paymentStatus: "paid",
    status: "complete",
    amount: r.amountCents,
    currency: "usd",
    livemode: r.livemode,
    source: "staff-confirmed-manual",
    method: r.method,
    taxTransactionId: r.taxTransactionId,
    receivedAt: r.receivedAt.toISOString(),
  };
  if (canonicalJson(settled[0].afterJson) !== canonicalJson(record)) throw fail();
  const payments = await tx.payment.findMany({
    where: { orderId: checkout.orderId!, provider: "MANUAL" },
    include: { events: true },
    take: 2,
  });
  const payment = payments[0];
  if (
    payments.length !== 1 ||
    payment.externalId !== r.id ||
    payment.currency !== "USD" ||
    payment.amountCents !== amountCents ||
    !["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)
  )
    throw fail();
  const events = payment.events.filter(
    (event) =>
      event.externalId === `checkout:${checkout.id}:paid` &&
      event.type === "manual.payment.settled" &&
      event.verifiedAt,
  );
  if (events.length !== 1 || canonicalJson(events[0].payload) !== canonicalJson(record))
    throw fail();
  return {
    paymentId: payment.id,
    manualSettlementId: r.id,
    paymentMethod: r.method as "CASH" | "ZELLE",
    receiptReference: r.reference,
    receivedAt: r.receivedAt,
    taxTransactionId: r.taxTransactionId,
    taxLines: e.taxLines,
  };
}
