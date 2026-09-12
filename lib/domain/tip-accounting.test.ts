import { expect, it } from "vitest";
import { tipAccounting, tipPayoutInput } from "./tip-accounting";
import type { RefundObservation } from "@/lib/commerce/refund-provider";
const refund = (amountCents = 108): RefundObservation => ({
  id: "re_synthetic",
  amountCents,
  currency: "USD",
  status: "succeeded",
  created: 1,
  requestId: null,
  requestHash: null,
  project: null,
  balanceTransactionId: "txn_synthetic",
  failureBalanceTransactionId: null,
});
const payout = { id: "p1", kind: "PAYMENT", amountCents: 100, reversalOfId: null };
it("excludes collected tax from driver entitlement and exposes a refunded paid-out tip as recoverable", () => {
  expect(tipAccounting(100, 108, [], [])).toMatchObject({
    payableCents: 100,
    paidCents: 0,
  });
  expect(tipAccounting(100, 108, [refund()], [payout])).toMatchObject({
    payableCents: 0,
    recoverableCents: 100,
    refundedTipCents: 100,
    taxRefundEvidence: "UNVERIFIED",
  });
});
it("blocks pending and partially allocated refunds without inventing a tax split", () => {
  expect(tipAccounting(100, 108, [refund(50)], [])).toMatchObject({
    payableCents: 0,
    refundedTipCents: null,
    review: true,
  });
  expect(tipAccounting(100, 108, [{ ...refund(), status: "pending" }], [])).toMatchObject(
    { payableCents: 0, review: true },
  );
});
it("requires returned-balance evidence after a refund debit fails", () => {
  expect(
    tipAccounting(100, 108, [{ ...refund(), status: "failed" }], []).payableCents,
  ).toBe(0);
  expect(
    tipAccounting(
      100,
      108,
      [{ ...refund(), status: "failed", failureBalanceTransactionId: "txn_returned" }],
      [],
    ).payableCents,
  ).toBe(100);
});
it("retains original transfers and permits one exact reversal only", () => {
  const reversal = { id: "r1", kind: "REVERSAL", amountCents: 100, reversalOfId: "p1" };
  expect(tipAccounting(100, 108, [], [payout, reversal])).toMatchObject({
    paidCents: 0,
    payableCents: 100,
  });
  expect(() =>
    tipAccounting(100, 108, [], [payout, reversal, { ...reversal, id: "r2" }]),
  ).toThrow();
  expect(() =>
    tipAccounting(100, 108, [], [payout, { ...reversal, amountCents: 50 }]),
  ).toThrow();
  expect(() => tipAccounting(100, 108, [refund(), refund()], [])).toThrow();
});
it("requires explicit receipt confirmation, whole cents and evidence notes", () => {
  expect(
    tipPayoutInput.safeParse({
      tipId: "t",
      requestKey: crypto.randomUUID(),
      amountCents: 1.5,
      reference: "bankref",
      paidOn: "2026-09-01",
      reason: "receipt",
      confirmed: false,
    }).success,
  ).toBe(false);
});
