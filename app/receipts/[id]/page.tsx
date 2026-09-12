import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/authz";
import { AccountError } from "@/lib/domain/account";
import { customerReceipt } from "@/lib/services/customer-receipt";
import { formatCents } from "@/lib/domain/money";
import { PrintReceipt } from "@/components/commerce/print-receipt";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Original order receipt",
  robots: { index: false, follow: false },
};
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  let r;
  try {
    r = await customerReceipt(session.user.id, (await params).id);
  } catch (e) {
    if (e instanceof AccountError && e.status === 404) notFound();
    if (e instanceof AccountError && e.status === 409)
      return (
        <main className="mx-auto max-w-2xl space-y-4 p-6">
          <h1 className="text-2xl font-semibold">Receipt unavailable</h1>
          <p>{e.message}</p>
          <Link className="underline" href="/account/support">
            Contact support
          </Link>
        </main>
      );
    throw e;
  }
  const date = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }).format(new Date(r.purchasedAt));
  const totals = [
    ["Merchandise", r.subtotalCents],
    ["Promotion savings", -r.promotionCents],
    ["Rewards applied", -r.rewardsCents],
    ["Recorded sales tax", r.taxCents],
  ] as const;
  return (
    <main className="order-receipt mx-auto my-6 max-w-3xl space-y-6 rounded-2xl border bg-white p-5 text-slate-900 sm:p-8">
      <header className="space-y-2">
        <p className="text-xl font-bold text-teal-800">Detergents Delivered</p>
        <h1 className="text-2xl font-semibold">Original order receipt</h1>
        {r.testReceipt && (
          <p className="rounded border-2 border-red-700 p-2 font-bold text-red-800">
            TEST RECEIPT — Not a live purchase
          </p>
        )}
        <p className="break-words">Order {r.number}</p>
        <p>Purchased {date} (Central Time)</p>
      </header>
      <section aria-label="Original delivery address">
        <h2 className="font-semibold">Delivery address at purchase</h2>
        <address className="not-italic">
          {r.address.line1}
          <br />
          {r.address.line2 && (
            <>
              {r.address.line2}
              <br />
            </>
          )}
          {r.address.city}, {r.address.region} {r.address.postalCode}
          <br />
          {r.address.country}
        </address>
      </section>
      <section aria-label="Purchased items" className="space-y-4">
        <h2 className="text-lg font-semibold">Purchased items</h2>
        {r.lines.map((l, i) => (
          <article className="receipt-line space-y-2 border-b pb-4" key={i}>
            <h3 className="font-semibold break-words">{l.name}</h3>
            <p className="text-sm break-words">SKU: {l.sku}</p>
            <p>
              {l.quantity} × {formatCents(l.unitPriceCents)}
            </p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt>Discounts and rewards</dt>
              <dd>{formatCents(-l.discountCents)}</dd>
              <dt>After savings</dt>
              <dd>{formatCents(l.netCents)}</dd>
              <dt>Recorded tax</dt>
              <dd>{formatCents(l.taxCents)}</dd>
              <dt className="font-semibold">Item total</dt>
              <dd className="font-semibold">{formatCents(l.totalCents)}</dd>
            </dl>
          </article>
        ))}
      </section>
      <dl className="receipt-totals grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
        {totals.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd>{formatCents(value)}</dd>
          </div>
        ))}
        <dt className="border-t pt-3 text-lg font-bold">Original payment</dt>
        <dd className="border-t pt-3 text-lg font-bold">{formatCents(r.totalCents)}</dd>
      </dl>
      <p className="text-sm">
        USD. This is the original purchase receipt. Later refunds and reward adjustments
        do not change these original amounts. View your account for current order
        activity.
      </p>
      <PrintReceipt />
      <nav className="receipt-actions flex flex-wrap gap-4">
        <Link className="underline" href={`/checkout/receipt/${r.checkoutId}`}>
          Payment status
        </Link>
        <Link className="underline" href="/account">
          Your account
        </Link>
        <Link className="underline" href="/account/support">
          Contact support
        </Link>
      </nav>
    </main>
  );
}
