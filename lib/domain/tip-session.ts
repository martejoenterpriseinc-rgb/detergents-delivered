import type Stripe from "stripe";
import type { DeliveryTip } from "@prisma/client";
import { AccountError } from "./account";
export function matchTipSession(t: DeliveryTip, s: Stripe.Checkout.Session) {
  const customer = typeof s.customer === "string" ? s.customer : s.customer?.id;
  if (
    s.client_reference_id !== t.id ||
    s.metadata?.tipId !== t.id ||
    s.metadata.project !== "detergents-delivered" ||
    s.mode !== "payment" ||
    s.livemode !== t.livemode ||
    s.currency !== "usd" ||
    !customer ||
    (t.stripeCustomerId && t.stripeCustomerId !== customer) ||
    (t.stripeSessionId && t.stripeSessionId !== s.id)
  )
    throw new AccountError("Tip payment identity requires review.", 409);
  if (s.status === "expired" && s.payment_status === "unpaid")
    return { state: "EXPIRED" as const, customerId: customer };
  if (s.status === "open" && s.payment_status === "unpaid")
    return { state: "OPEN" as const, customerId: customer };
  const lines = s.line_items,
    pi = s.payment_intent;
  const line = lines?.data[0],
    product = line?.price?.product;
  const tax = s.total_details?.amount_tax;
  if (
    s.status !== "complete" ||
    s.payment_status !== "paid" ||
    s.automatic_tax.status !== "complete" ||
    typeof tax !== "number" ||
    !Number.isSafeInteger(tax) ||
    tax < 0 ||
    s.amount_subtotal !== t.amountCents ||
    s.amount_total !== t.amountCents + tax ||
    s.total_details?.amount_discount !== 0 ||
    s.total_details?.amount_shipping !== 0 ||
    !lines ||
    lines.has_more ||
    lines.data.length !== 1 ||
    line?.quantity !== 1 ||
    line.currency !== "usd" ||
    line.price?.currency !== "usd" ||
    line.price.unit_amount !== t.amountCents ||
    line.price.tax_behavior !== "exclusive" ||
    line.amount_subtotal !== t.amountCents ||
    line.amount_tax !== tax ||
    line.amount_discount !== 0 ||
    line.amount_total !== s.amount_total ||
    !product ||
    typeof product === "string" ||
    ("deleted" in product && product.deleted) ||
    !("metadata" in product) ||
    product.metadata.tipId !== t.id ||
    (typeof product.tax_code === "string" ? product.tax_code : product.tax_code?.id) !==
      t.taxCode ||
    !pi ||
    typeof pi === "string" ||
    pi.status !== "succeeded" ||
    pi.amount !== s.amount_total ||
    pi.amount_received !== s.amount_total ||
    pi.currency !== "usd" ||
    pi.livemode !== t.livemode ||
    (typeof pi.customer === "string" ? pi.customer : pi.customer?.id) !== customer ||
    pi.metadata.tipId !== t.id ||
    pi.metadata.project !== "detergents-delivered"
  )
    throw new AccountError("Tip payment totals or tax evidence require review.", 409);
  return {
    state: "PAID" as const,
    customerId: customer,
    paymentIntentId: pi.id,
    taxCents: tax,
    totalCents: s.amount_total,
  };
}
