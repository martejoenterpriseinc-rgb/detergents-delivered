import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/authz";
import { AccountError } from "@/lib/domain/account";
import { readSubscriptionCycle } from "@/lib/services/subscription-cycles";
import { runtimeCommerceConfiguration } from "@/lib/commerce/runtime";
import { ConnectedCheckout } from "@/components/commerce/connected-checkout";
export default async function SubscriptionCyclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const cycle = await readSubscriptionCycle(session.user.id, (await params).id).catch(
    (e) => {
      if (e instanceof AccountError && [403, 404].includes(e.status)) notFound();
      throw e;
    },
  );
  const enabled = (await runtimeCommerceConfiguration()).enabled;
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <Link href="/account/subscriptions" className="underline">
        Back to subscriptions
      </Link>
      <h1 className="text-3xl font-semibold">Review your quarterly purchase</h1>
      <p>
        Scheduled quarter: {cycle.scheduledFor}. Review current prices, tax and delivery
        availability before paying. No automatic charges.
      </p>
      {cycle.checkoutId ? (
        <p>
          <Link className="underline" href={`/checkout/receipt/${cycle.checkoutId}`}>
            Manage this quarter’s checkout
          </Link>
        </p>
      ) : !cycle.ready ? (
        <p>
          This quarter is no longer open for checkout. Manage your subscription to see its
          current schedule.
        </p>
      ) : !enabled ? (
        <p>
          Ordering is not open right now. Your quarter is saved for review; no payment or
          delivery reservation has been made.
        </p>
      ) : (
        <ConnectedCheckout
          addresses={cycle.addresses}
          subscription={{ id: cycle.id, lines: cycle.lines }}
        />
      )}
    </main>
  );
}
