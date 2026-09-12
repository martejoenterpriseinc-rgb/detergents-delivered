import type { DeliveryTip } from "@prisma/client";
import { z } from "zod";
import { AccountError } from "@/lib/domain/account";
import { readCommerce } from "./runtime";
import { stripeClient, verifyStripeSetup } from "./stripe";
export const tipSourceSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  address: z.object({
    line1: z.string(),
    line2: z.string(),
    city: z.string(),
    region: z.string(),
    postalCode: z.string(),
    country: z.literal("US"),
  }),
});
export async function tipConfiguration(recovery = false) {
  const c = await readCommerce(recovery);
  if (!recovery && c.live && process.env.DD_LIVE_TIPS_ACCEPTED !== "true")
    throw new AccountError("Tipping is not available yet.", 503);
  if (
    !recovery &&
    (process.env.DD_TIPS_ENABLED !== "true" ||
      !/^txcd_\d{8}$/.test(process.env.DD_TIP_TAX_CODE ?? ""))
  )
    throw new AccountError("Tipping is not available yet.", 503);
  return { ...c, taxCode: process.env.DD_TIP_TAX_CODE ?? "" };
}
async function bound(t: DeliveryTip, recovery: boolean) {
  const c = await tipConfiguration(recovery);
  if (c.accountId !== t.stripeAccountId || c.live !== t.livemode)
    throw new AccountError("Tip payment account requires review.", 409);
  return c;
}
export async function createTipSession(t: DeliveryTip) {
  const c = await bound(t, false),
    source = tipSourceSchema.parse(t.source);
  if (
    !t.taxCode ||
    t.taxCode !== c.taxCode ||
    t.expiresAt.getTime() < Date.now() + 30 * 60000
  )
    throw new AccountError("Tip setup needs reconciliation before another attempt.", 409);
  const stripe = await verifyStripeSetup(source.address.region, c);
  const address = {
    line1: source.address.line1,
    line2: source.address.line2 || undefined,
    city: source.address.city,
    state: source.address.region,
    postal_code: source.address.postalCode,
    country: source.address.country,
  };
  const customer = await stripe.customers.create(
    {
      email: source.email,
      name: source.name,
      address,
      shipping: { name: source.name, address },
      metadata: { tipId: t.id, project: "detergents-delivered" },
    },
    { idempotencyKey: `dd:tip:${t.id}:customer:v1` },
  );
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      customer: customer.id,
      client_reference_id: t.id,
      automatic_tax: { enabled: true },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: t.amountCents,
            tax_behavior: "exclusive",
            product_data: {
              name: "Optional delivery tip",
              tax_code: t.taxCode,
              metadata: { tipId: t.id },
            },
          },
        },
      ],
      metadata: { tipId: t.id, project: "detergents-delivered" },
      payment_intent_data: { metadata: { tipId: t.id, project: "detergents-delivered" } },
      expires_at: Math.floor(t.expiresAt.getTime() / 1000),
      success_url: `${c.origin}/account/orders/${t.orderId}/tip`,
      cancel_url: `${c.origin}/account/orders/${t.orderId}/tip?cancelled=1`,
    },
    { idempotencyKey: `dd:tip:${t.id}:session:v1` },
  );
  return { session, customerId: customer.id };
}
export async function retrieveTipSession(t: DeliveryTip, sessionId: string) {
  const c = await bound(t, true),
    stripe = await stripeClient(c);
  const account = await stripe.accounts.retrieve(null);
  if (account.id !== c.accountId)
    throw new AccountError("Tip account identity could not be verified.", 409);
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price.product", "payment_intent"],
  });
}
