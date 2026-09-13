import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { readPaymentOverview } from "@/lib/services/payment-overview";
import { PaymentDashboard } from "@/components/admin/payment-dashboard";
import { ZodError } from "zod";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  let data;
  try {
    data = await readPaymentOverview(session.user.id, await searchParams);
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    return (
      <div role="alert">
        Invalid payment filters.{" "}
        <Link href="/admin/payments" className="underline">
          Reset filters
        </Link>
      </div>
    );
  }
  return <PaymentDashboard data={data} />;
}
