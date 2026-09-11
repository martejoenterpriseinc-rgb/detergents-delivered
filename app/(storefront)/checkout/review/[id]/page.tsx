import { requireAuth } from "@/lib/authz";
import { ownedCheckout } from "@/lib/commerce/checkout";
import { publicCheckout } from "@/lib/commerce/quote";
import { ConnectedCheckout } from "@/components/commerce/connected-checkout";
import { CheckoutReceipt } from "@/components/commerce/checkout-receipt";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(),
    attempt = await ownedCheckout(session.user.id, (await params).id);
  const quote = publicCheckout(attempt);
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-10">
      {attempt.state !== "QUOTED" ? (
        <CheckoutReceipt initial={quote} />
      ) : attempt.expiresAt <= new Date() ? (
        <>
          <h1 className="text-2xl font-semibold">This quote expired</h1>
          <p>Request a fresh quote before paying.</p>
          <a href="/checkout" className="underline">
            Review your cart
          </a>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Review your prepared order</h1>
          <p>
            Check these items, prices, rewards and delivery details before continuing to
            payment.
          </p>
          <ConnectedCheckout
            initialQuote={quote}
            addresses={[{ id: "saved", label: quote.address }]}
          />
        </>
      )}
    </main>
  );
}
