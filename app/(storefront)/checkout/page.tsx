import { commerceConfiguration } from "@/lib/commerce/config";
import { ConnectedCheckout } from "@/components/commerce/connected-checkout";
import { customerIdentity } from "@/lib/services/customer-account";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { getPublicDeliveryInfo } from "@/lib/services/delivery-settings";

export default async function CheckoutPage() {
  const session = await requireAuth();
  if (commerceConfiguration().enabled) {
    const { customer } = await customerIdentity(prisma, session.user.id);
    const addresses = await prisma.address.findMany({
      where: {
        customerId: customer.id,
        deletedAt: null,
        validatedAt: { not: null },
        validationSource: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="mb-6 text-3xl font-semibold">Checkout</h1>
        <ConnectedCheckout
          addresses={addresses
            .filter((a) => !a.validationSource?.startsWith("CHECKOUT_SNAPSHOT:"))
            .map((a) => ({ id: a.id, label: `${a.line1}, ${a.city} ${a.postalCode}` }))}
        />
      </div>
    );
  }
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
