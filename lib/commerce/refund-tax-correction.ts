import type Stripe from "stripe";
import { AccountError } from "@/lib/domain/account";
import { readCommerce } from "./runtime";
import { stripeClient } from "./stripe";
export type RefundTaxCorrectionBinding = {
  compensationId: string;
  accountId: string;
  live: boolean;
  originalTaxTransactionId: string;
  refundTaxTransactionId: string;
  cashCents: number;
  taxCents: number;
};
const fail = () =>
  new AccountError(
    "Refund tax correction evidence does not match the original reversal.",
    409,
  );
const options = { timeout: 8000, maxNetworkRetries: 0 };
function lines(t: Stripe.Tax.Transaction, live: boolean) {
  if (
    t.object !== "tax.transaction" ||
    t.currency !== "usd" ||
    t.livemode !== live ||
    !t.line_items ||
    t.line_items.has_more ||
    !t.line_items.data.length ||
    t.line_items.data.length > 30 ||
    new Set(t.line_items.data.map((l) => l.id)).size !== t.line_items.data.length ||
    (t.shipping_cost &&
      (t.shipping_cost.amount !== 0 || t.shipping_cost.amount_tax !== 0))
  )
    throw fail();
  return t.line_items.data;
}
export function verifyTaxCorrection(
  b: RefundTaxCorrectionBinding,
  original: Stripe.Tax.Transaction,
  correction: Stripe.Tax.Transaction,
) {
  const before = lines(original, b.live),
    after = lines(correction, b.live);
  if (
    original.id !== b.refundTaxTransactionId ||
    original.type !== "reversal" ||
    original.reversal?.original_transaction !== b.originalTaxTransactionId ||
    before.some(
      (l) =>
        l.type !== "reversal" ||
        l.livemode !== b.live ||
        !Number.isSafeInteger(l.amount) ||
        !Number.isSafeInteger(l.amount_tax) ||
        l.amount > 0 ||
        l.amount_tax > 0,
    ) ||
    before.reduce((n, l) => n + l.amount + l.amount_tax, 0) !== -b.cashCents ||
    before.reduce((n, l) => n + l.amount_tax, 0) !== -b.taxCents ||
    !/^tax_[A-Za-z0-9]+$/.test(correction.id) ||
    correction.type !== "reversal" ||
    correction.reversal?.original_transaction !== original.id ||
    after.length !== before.length ||
    !Number.isSafeInteger(correction.posted_at) ||
    correction.posted_at < original.posted_at
  )
    throw fail();
  for (const l of before) {
    const matches = after.filter((v) => v.reversal?.original_line_item === l.id),
      v = matches[0];
    if (
      matches.length !== 1 ||
      v.type !== "reversal" ||
      v.livemode !== b.live ||
      v.amount !== -l.amount ||
      v.amount_tax !== -l.amount_tax ||
      v.tax_behavior !== l.tax_behavior ||
      v.tax_code !== l.tax_code ||
      v.quantity !== l.quantity
    )
      throw fail();
  }
  return {
    correctionTaxTransactionId: correction.id,
    refundTaxTransactionId: original.id,
    originalTaxTransactionId: b.originalTaxTransactionId,
    cashCents: b.cashCents,
    taxCents: b.taxCents,
    postedAt: correction.posted_at,
  };
}
/** Recovery verifies an existing provider adjustment. It never edits tax history. */
export async function readTaxCorrection(
  b: RefundTaxCorrectionBinding,
  correctionId: string,
) {
  if (!/^tax_[A-Za-z0-9]+$/.test(correctionId)) throw fail();
  const c = await readCommerce(true);
  if (c.accountId !== b.accountId || c.live !== b.live) throw fail();
  const stripe = await stripeClient(c),
    account = await stripe.accounts.retrieve(null, {}, options);
  if (account.id !== b.accountId) throw fail();
  const [original, correction] = await Promise.all([
    stripe.tax.transactions.retrieve(
      b.refundTaxTransactionId,
      { expand: ["line_items"] },
      options,
    ),
    stripe.tax.transactions.retrieve(correctionId, { expand: ["line_items"] }, options),
  ]);
  if (correction.id !== correctionId) throw fail();
  return verifyTaxCorrection(b, original, correction);
}
