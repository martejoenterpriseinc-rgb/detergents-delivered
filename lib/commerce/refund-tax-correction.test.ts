import { expect, it } from "vitest";
import type Stripe from "stripe";
import { verifyTaxCorrection } from "./refund-tax-correction";
const binding = {
  compensationId: "comp",
  accountId: "acct_test",
  live: false,
  originalTaxTransactionId: "tax_sale",
  refundTaxTransactionId: "tax_refund",
  cashCents: 108,
  taxCents: 8,
};
const original = {
  object: "tax.transaction",
  id: "tax_refund",
  currency: "usd",
  livemode: false,
  type: "reversal",
  posted_at: 100,
  reversal: { original_transaction: "tax_sale" },
  line_items: {
    has_more: false,
    data: [
      {
        id: "tax_li_original",
        amount: -100,
        amount_tax: -8,
        quantity: 1,
        tax_behavior: "exclusive",
        tax_code: "txcd_original",
        type: "reversal",
        livemode: false,
        reversal: { original_line_item: "tax_li_sale" },
      },
    ],
  },
} as Stripe.Tax.Transaction;
const correction = {
  ...original,
  id: "tax_correct",
  posted_at: 101,
  reversal: { original_transaction: original.id },
  line_items: {
    ...original.line_items!,
    data: [
      {
        ...original.line_items!.data[0],
        id: "tax_li_correct",
        amount: 100,
        amount_tax: 8,
        reversal: { original_line_item: "tax_li_original" },
      },
    ],
  },
} as Stripe.Tax.Transaction;
it("accepts only an exact positive reversal of the verified failed refund tax transaction", () => {
  expect(verifyTaxCorrection(binding, original, correction)).toMatchObject({
    correctionTaxTransactionId: "tax_correct",
    cashCents: 108,
    taxCents: 8,
  });
  for (const patch of [
    { livemode: true },
    { currency: "cad" },
    { reversal: { original_transaction: "tax_unrelated" } },
    { posted_at: 99 },
  ])
    expect(() =>
      verifyTaxCorrection(binding, original, { ...correction, ...patch }),
    ).toThrow();
  const changed = structuredClone(correction);
  changed.line_items!.data[0].amount_tax = 7;
  expect(() => verifyTaxCorrection(binding, original, changed)).toThrow();
  changed.line_items!.data[0].amount_tax = 8;
  changed.line_items!.has_more = true;
  expect(() => verifyTaxCorrection(binding, original, changed)).toThrow();
});
