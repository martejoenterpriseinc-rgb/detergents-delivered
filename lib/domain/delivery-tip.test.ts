import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { DeliveryTip } from "@prisma/client";
import { deliveryTipInput, deliveryTipAmount } from "./delivery-tip";
import { matchTipSession } from "./tip-session";
import { tipSession } from "@/tests/tip-session-fixture";
it("calculates optional tips in integer cents and limits amount/percentage input", () => {
  const base = { orderId: "o", requestKey: randomUUID() };
  expect(
    deliveryTipAmount(deliveryTipInput.parse({ ...base, choice: "DECLINE" }), 2100),
  ).toBe(0);
  expect(
    deliveryTipAmount(
      deliveryTipInput.parse({ ...base, choice: "PERCENT", percent: 15 }),
      2100,
    ),
  ).toBe(315);
  expect(
    deliveryTipAmount(
      deliveryTipInput.parse({ ...base, choice: "PERCENT", percent: 15 }),
      2105,
    ),
  ).toBe(316);
  expect(() =>
    deliveryTipInput.parse({ ...base, choice: "AMOUNT", amountCents: 0 }),
  ).toThrow();
  expect(() =>
    deliveryTipInput.parse({ ...base, choice: "PERCENT", percent: 101 }),
  ).toThrow();
  expect(() =>
    deliveryTipAmount(
      deliveryTipInput.parse({ ...base, choice: "PERCENT", percent: 15 }),
      0,
    ),
  ).toThrow();
});
const tip = {
  id: "tip",
  amountCents: 315,
  stripeSessionId: "cs_tip",
  stripeCustomerId: "cus_tip",
  livemode: false,
  taxCode: "txcd_00000000",
} as DeliveryTip;
it("matches paid tip evidence only for the pinned payment, product, currency, tax and exact cents", () => {
  expect(matchTipSession(tip, tipSession("tip", 315, true))).toMatchObject({
    state: "PAID",
    taxCents: 25,
    totalCents: 340,
    paymentIntentId: "pi_tip",
  });
  for (const patch of [
    { customer: "cus_other" },
    { livemode: true },
    { amount_total: 341 },
    { amount_subtotal: 316 },
    { currency: "eur" },
    { payment_intent: "pi_tip" },
    { payment_status: "unpaid" },
    { line_items: { has_more: true, data: [] } },
  ]) {
    expect(() =>
      matchTipSession(tip, { ...tipSession("tip", 315, true), ...patch } as ReturnType<
        typeof tipSession
      >),
    ).toThrow();
  }
  const wrong = tipSession("tip", 315, true);
  wrong.total_details!.amount_tax = 24;
  expect(() => matchTipSession(tip, wrong)).toThrow();
});
it("never calls open or expired sessions paid", () => {
  const s = tipSession("tip");
  expect(matchTipSession(tip, s).state).toBe("OPEN");
  s.status = "expired";
  expect(matchTipSession(tip, s).state).toBe("EXPIRED");
  s.payment_status = "paid";
  expect(() => matchTipSession(tip, s)).toThrow();
});
