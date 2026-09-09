import { requireAuth } from "@/lib/authz";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { getPublicDeliveryInfo } from "@/lib/services/delivery-settings";

export default async function CheckoutPage() {
  await requireAuth();
  const delivery = await getPublicDeliveryInfo();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold text-teal-950">Checkout</h1>
      <p className="mt-2 max-w-2xl text-teal-800">
        Confirm a delivery address in a listed ZIP for our current select Chicagoland
        counties ({delivery.enabledCountyNames.join(", ") || "none enabled"}).{" "}
        {delivery.weeklySummary} Cards are not charged. {delivery.noSameDaySummary}
        {delivery.nextWindowLabel ? ` Next window: ${delivery.nextWindowLabel}.` : ""}
      </p>
      <div className="mt-8">
        <CheckoutForm
          delivery={{
            enabledCountyCodes: delivery.enabledCountyCodes,
            nextWindowLabel: delivery.nextWindowLabel,
            exampleZip: delivery.exampleZip,
            exampleZips: delivery.exampleZips,
            weeklySummary: delivery.weeklySummary,
            serviceAreaSummary: delivery.serviceAreaSummary,
          }}
        />
      </div>
    </div>
  );
}
