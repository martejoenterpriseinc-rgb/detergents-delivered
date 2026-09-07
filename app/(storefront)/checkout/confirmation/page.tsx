import { ConfirmationView } from "@/components/storefront/confirmation-view";

export default async function CheckoutConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <ConfirmationView orderId={params.order} />
    </div>
  );
}
