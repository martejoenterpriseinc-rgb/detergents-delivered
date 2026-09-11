import Stripe from "stripe";
import type { requireCommerce } from "./config";
import { readCommerce } from "./runtime";
import { AccountError } from "@/lib/domain/account";
import type { CheckoutSnapshot } from "./domain";

export async function stripeClient(supplied?: ReturnType<typeof requireCommerce>) {
  const config = supplied ?? (await readCommerce(true));
  return new Stripe(config.key!, {
    apiVersion: "2026-08-26.dahlia",
    timeout: 20000,
    maxNetworkRetries: 2,
  });
}
export async function verifyStripeSetup(
  region: string,
  supplied?: ReturnType<typeof requireCommerce>,
) {
  const config = supplied ?? (await readCommerce());
  const stripe = await stripeClient(config);
  const [account, settings, registrations] = await Promise.all([
    stripe.accounts.retrieve(null),
    stripe.tax.settings.retrieve(),
    stripe.tax.registrations.list({ status: "active", limit: 100 }),
  ]);
  if (account.id !== config.accountId || !account.charges_enabled)
    throw new AccountError("Payment account needs review before ordering can open.", 503);
  if (
    settings.status !== "active" ||
    !registrations.data.some(
      (r) => r.country === "US" && r.country_options.us?.state === region,
    )
  )
    throw new AccountError(
      "Sales tax setup is incomplete for this delivery area. Contact support.",
      503,
    );
  return stripe;
}
const destination = (s: CheckoutSnapshot) => ({
  line1: s.address.line1,
  line2: s.address.line2 || undefined,
  city: s.address.city,
  state: s.address.region,
  postal_code: s.address.postalCode,
  country: s.address.country,
});
export async function calculateCheckoutTax(s: CheckoutSnapshot) {
  const config = await readCommerce();
  const stripe = await verifyStripeSetup(s.address.region, config);
  const calc = await stripe.tax.calculations.create({
    currency: "usd",
    customer_details: { address: destination(s), address_source: "shipping" },
    line_items: s.lines.map((l) => ({
      amount: l.netCents,
      quantity: 1,
      reference: l.variantId,
      tax_code: l.taxCode,
      tax_behavior: "exclusive",
    })),
    expand: ["line_items"],
  });
  if (calc.livemode !== config.live || calc.tax_amount_inclusive !== 0)
    throw new AccountError("Tax quote cannot be confirmed.", 503);
  return {
    taxCents: calc.tax_amount_exclusive,
    totalCents: calc.amount_total,
    taxCalculationId: calc.id,
    taxBreakdown: calc.tax_breakdown,
  };
}
export async function createStripeCheckout(
  id: string,
  s: CheckoutSnapshot,
  expiresAt: Date,
) {
  const config = await readCommerce();
  const stripe = await verifyStripeSetup(s.address.region, config);
  // One immutable shipping snapshot per checkout: another browser cannot change the tax address.
  const customer = await stripe.customers.create(
    {
      email: s.email,
      name: s.name,
      address: destination(s),
      shipping: { name: s.name, address: destination(s) },
      metadata: { checkoutId: id, project: "detergents-delivered" },
    },
    { idempotencyKey: `dd:${id}:customer:v1` },
  );
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer: customer.id,
      client_reference_id: id,
      integration_identifier: "detergents-delivered-checkout-qxmrnpta",
      automatic_tax: { enabled: true },
      line_items: s.lines.map((l) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: l.netCents,
          tax_behavior: "exclusive",
          product_data: {
            name: `${l.name} × ${l.quantity}`,
            tax_code: l.taxCode,
            metadata: { variantId: l.variantId },
          },
        },
      })),
      metadata: { checkoutId: id, project: "detergents-delivered" },
      payment_intent_data: {
        metadata: { checkoutId: id, project: "detergents-delivered" },
      },
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      success_url: `${config.origin}/checkout/receipt/${id}`,
      cancel_url: `${config.origin}/checkout/receipt/${id}?cancelled=1`,
      custom_text: {
        submit: {
          message: `Delivery window: ${s.launchDate}–${s.firstDeliveryBy}. Exact date follows route review. Promotions $${(s.promotionCents / 100).toFixed(2)}; reward credit $${(s.rewardsCents / 100).toFixed(2)} already deducted.`,
        },
      },
    },
    { idempotencyKey: `dd:${id}:session:v1` },
  );
  return { session, customerId: customer.id };
}
export function assertSessionIdentity(
  session: Stripe.Checkout.Session,
  id: string,
  s: CheckoutSnapshot,
  live: boolean,
) {
  if (
    session.livemode !== live ||
    session.client_reference_id !== id ||
    session.metadata?.checkoutId !== id ||
    session.metadata.project !== "detergents-delivered" ||
    session.mode !== "payment" ||
    session.currency !== "usd" ||
    session.amount_total !== s.totalCents ||
    session.total_details?.amount_tax !== s.taxCents ||
    session.automatic_tax.status !== "complete"
  )
    throw new AccountError(
      "Payment details differ from the saved checkout. Staff review is required.",
      409,
    );
}
