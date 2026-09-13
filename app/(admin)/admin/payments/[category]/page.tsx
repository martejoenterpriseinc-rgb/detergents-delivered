import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/authz";
import { paymentCategory } from "@/lib/domain/payment-overview";
import { readPaymentOverview } from "@/lib/services/payment-overview";
import { PaymentDashboard } from "@/components/admin/payment-dashboard";
import { ZodError } from "zod";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole("ADMIN", "SUPER_ADMIN");
  const parsed = paymentCategory.safeParse((await params).category);
  if (!parsed.success) notFound();
  let data;
  try {
    data = await readPaymentOverview(session.user.id, await searchParams, parsed.data);
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
  return <PaymentDashboard data={data} category={parsed.data} />;
}
