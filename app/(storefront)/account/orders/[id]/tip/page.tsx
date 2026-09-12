import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/authz";
import { AccountError } from "@/lib/domain/account";
import { readDeliveryTips } from "@/lib/services/delivery-tips";
import { DeliveryTip } from "@/components/account/delivery-tip";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  let data;
  try {
    data = await readDeliveryTips(session.user.id, (await params).id);
  } catch (e) {
    if (e instanceof AccountError && [403, 404].includes(e.status)) notFound();
    if (e instanceof AccountError && e.status === 409)
      return (
        <div className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-semibold">Tip unavailable</h1>
          <p>The original order or delivery needs review. Please contact support.</p>
        </div>
      );
    throw e;
  }
  return <DeliveryTip data={data} />;
}
