import { stripeClient } from "@/lib/commerce/stripe";
import { requireCommerce } from "@/lib/commerce/config";
import { reconcileCheckout } from "@/lib/commerce/checkout";
import { prisma } from "@/lib/prisma";
import type Stripe from "stripe";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Signature required", { status: 400 });
  let event: Stripe.Event;
  try {
    const reader = request.body?.getReader();
    if (!reader) return new Response("Body required", { status: 400 });
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        return new Response("Payload too large", { status: 413 });
      }
      parts.push(part.value);
    }
    event = stripeClient().webhooks.constructEvent(
      Buffer.concat(parts),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return new Response("Webhook could not be verified", { status: 400 });
  }
  const config = requireCommerce(true);
  if (
    event.livemode !== config.live ||
    (event.account && event.account !== config.accountId)
  )
    return new Response("Environment mismatch", { status: 400 });
  if (
    ![
      "checkout.session.completed",
      "checkout.session.expired",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
    ].includes(event.type)
  )
    return Response.json({ received: true });
  const session = event.data.object as Stripe.Checkout.Session;
  if (
    !session.client_reference_id ||
    session.metadata?.project !== "detergents-delivered"
  )
    return Response.json({ received: true });
  try {
    const a = await prisma.checkoutAttempt.findUnique({
      where: { id: session.client_reference_id },
    });
    if (
      !a ||
      a.stripeAccountId !== config.accountId ||
      a.livemode !== config.live ||
      (a.stripeSessionId && a.stripeSessionId !== session.id)
    )
      return new Response("Unknown checkout", { status: 409 });
    // Creation may have succeeded at Stripe before the app saved the response.
    await prisma.checkoutAttempt.updateMany({
      where: { id: a.id, stripeSessionId: null },
      data: { stripeSessionId: session.id },
    });
    await reconcileCheckout(a.id, { id: event.id, type: event.type });
    return Response.json({ received: true });
  } catch {
    return new Response("Reconciliation pending", { status: 503 });
  }
}
