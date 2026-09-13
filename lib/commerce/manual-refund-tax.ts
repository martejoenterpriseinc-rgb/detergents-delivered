import type Stripe from "stripe";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "./domain";
import { readCommerce } from "./runtime";
import { stripeClient } from "./stripe";
export type ManualTaxReversalBinding = {
  requestId: string;
  requestHash: string;
  checkoutId: string;
  settlementId: string;
  accountId: string;
  live: boolean;
  originalTransactionId: string;
  receivedAt: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  };
  saleLines: { variantId: string; netCents: number; taxCents: number; taxCode: string }[];
  refundLines: {
    orderItemId: string;
    variantId: string;
    netCents: number;
    taxCents: number;
    quantity: number;
  }[];
};
const fail = () =>
  new AccountError(
    "Manual refund tax evidence could not be verified. The money-return receipt remains recorded.",
    409,
  );
const options = { timeout: 8000, maxNetworkRetries: 0 };
const reference = (b: ManualTaxReversalBinding) => `dd-manual-refund:${b.requestId}`;
function checkedLines(t: Stripe.Tax.Transaction, live: boolean) {
  if (
    t.object !== "tax.transaction" ||
    t.currency !== "usd" ||
    t.livemode !== live ||
    !t.line_items ||
    t.line_items.has_more ||
    t.line_items.data.length > 30 ||
    new Set(t.line_items.data.map((l) => l.id)).size !== t.line_items.data.length ||
    new Set(t.line_items.data.map((l) => l.reference)).size !==
      t.line_items.data.length ||
    (t.shipping_cost &&
      (t.shipping_cost.amount !== 0 || t.shipping_cost.amount_tax !== 0))
  )
    throw fail();
  return t.line_items.data;
}
export function manualTaxReversalPayload(
  b: ManualTaxReversalBinding,
  t: Stripe.Tax.Transaction,
): Stripe.Tax.TransactionCreateReversalParams {
  const lines = checkedLines(t, b.live),
    address = t.customer_details.address;
  if (
    t.id !== b.originalTransactionId ||
    t.type !== "transaction" ||
    t.reversal ||
    t.reference !== `dd-manual:${b.settlementId}` ||
    t.metadata?.project !== "detergents-delivered" ||
    t.metadata?.checkoutId !== b.checkoutId ||
    t.metadata?.manualSettlementId !== b.settlementId ||
    t.posted_at !== Math.floor(new Date(b.receivedAt).getTime() / 1000) ||
    !address ||
    canonicalJson({
      line1: address.line1,
      line2: address.line2 ?? "",
      city: address.city,
      region: address.state,
      postalCode: address.postal_code,
      country: address.country,
    }) !== canonicalJson(b.address) ||
    lines.length !== b.saleLines.length ||
    !b.refundLines.length ||
    b.refundLines.length > 30 ||
    new Set(b.refundLines.map((l) => l.variantId)).size !== b.refundLines.length
  )
    throw fail();
  for (const l of lines) {
    const expected = b.saleLines.find((v) => v.variantId === l.reference);
    if (
      !expected ||
      l.livemode !== b.live ||
      l.type !== "transaction" ||
      l.reversal ||
      l.quantity !== 1 ||
      l.tax_behavior !== "exclusive" ||
      l.tax_code !== expected.taxCode ||
      l.amount !== expected.netCents ||
      l.amount_tax !== expected.taxCents
    )
      throw fail();
  }
  return {
    mode: "partial",
    original_transaction: t.id,
    reference: reference(b),
    expand: ["line_items"],
    metadata: {
      project: "detergents-delivered",
      manualRefundRequestId: b.requestId,
      requestHash: b.requestHash,
    },
    line_items: b.refundLines.map((l) => {
      const original = lines.find((v) => v.reference === l.variantId);
      if (
        !original ||
        ![l.netCents, l.taxCents, l.quantity].every(Number.isSafeInteger) ||
        l.netCents < 0 ||
        l.taxCents < 0 ||
        l.netCents > original.amount ||
        l.taxCents > original.amount_tax ||
        l.quantity < 1
      )
        throw fail();
      return {
        amount: -l.netCents,
        amount_tax: -l.taxCents,
        original_line_item: original.id,
        reference: l.orderItemId,
        quantity: l.quantity,
      };
    }),
  };
}
export function verifyManualTaxReversal(
  b: ManualTaxReversalBinding,
  p: Stripe.Tax.TransactionCreateReversalParams,
  t: Stripe.Tax.Transaction,
) {
  const lines = checkedLines(t, b.live);
  if (
    !/^tax_[A-Za-z0-9]+$/.test(t.id) ||
    t.type !== "reversal" ||
    t.reversal?.original_transaction !== b.originalTransactionId ||
    t.reference !== reference(b) ||
    t.metadata?.project !== "detergents-delivered" ||
    t.metadata?.manualRefundRequestId !== b.requestId ||
    t.metadata?.requestHash !== b.requestHash ||
    !Number.isSafeInteger(t.posted_at) ||
    t.posted_at <= 0 ||
    lines.length !== p.line_items!.length
  )
    throw fail();
  const taxLines = lines
    .map((l) => {
      const expected = p.line_items!.find((v) => v.reference === l.reference);
      const source = b.refundLines.find((v) => v.orderItemId === l.reference);
      const original = b.saleLines.find((v) => v.variantId === source?.variantId);
      if (
        !expected ||
        !source ||
        !original ||
        l.type !== "reversal" ||
        l.livemode !== b.live ||
        l.reversal?.original_line_item !== expected.original_line_item ||
        l.amount !== expected.amount ||
        l.amount_tax !== expected.amount_tax ||
        l.quantity !== expected.quantity ||
        l.tax_behavior !== "exclusive" ||
        l.tax_code !== original.taxCode
      )
        throw fail();
      return {
        orderItemId: l.reference,
        originalLineItemId: expected.original_line_item,
        netCents: -l.amount,
        taxCents: -l.amount_tax,
      };
    })
    .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  return {
    originalTaxTransactionId: b.originalTransactionId,
    refundTaxTransactionId: t.id,
    postedAt: t.posted_at,
    taxLines,
  };
}
/** Exactly one create is allowed by the durable service claim. Recovery is GET-only. */
export async function executeManualTaxReversal(
  b: ManualTaxReversalBinding,
  recoveredId?: string,
  authorizeCreate?: () => Promise<void>,
) {
  const c = await readCommerce(true);
  if (c.accountId !== b.accountId || c.live !== b.live) throw fail();
  const stripe = await stripeClient(c),
    account = await stripe.accounts.retrieve(null, {}, options);
  if (account.id !== b.accountId) throw fail();
  const original = await stripe.tax.transactions.retrieve(
    b.originalTransactionId,
    { expand: ["line_items"] },
    options,
  );
  const payload = manualTaxReversalPayload(b, original);
  const current = await readCommerce(true);
  if (
    current.accountId !== c.accountId ||
    current.live !== c.live ||
    current.key !== c.key
  )
    throw fail();
  if (!recoveredId) {
    if (!authorizeCreate) throw fail();
    await authorizeCreate();
  }
  const t = recoveredId
    ? await stripe.tax.transactions.retrieve(
        recoveredId,
        { expand: ["line_items"] },
        options,
      )
    : await stripe.tax.transactions.createReversal(payload, {
        ...options,
        idempotencyKey: reference(b),
      });
  if (recoveredId && t.id !== recoveredId) throw fail();
  return verifyManualTaxReversal(b, payload, t);
}
