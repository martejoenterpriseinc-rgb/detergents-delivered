import { Card } from "@/components/ui/card";
import { DeliveryChecker } from "@/components/storefront/delivery-checker";
import { getPublicDeliveryInfo } from "@/lib/services/delivery-settings";

export default async function DeliveryAreaPage() {
  const delivery = await getPublicDeliveryInfo();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold text-teal-950">Delivery area</h1>
      <p className="mt-2 max-w-2xl text-lg text-teal-800">
        {delivery.serviceAreaSummary} {delivery.weeklySummary} {delivery.noSameDaySummary}
        {delivery.nextWindowLabel
          ? ` Next available window: ${delivery.nextWindowLabel}.`
          : ""}
      </p>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-teal-950">Check your ZIP</h2>
          <DeliveryChecker
            config={{
              enabledCountyCodes: delivery.enabledCountyCodes,
              nextWindowLabel: delivery.nextWindowLabel,
              exampleZip: delivery.exampleZip,
              exampleZips: delivery.exampleZips,
            }}
          />
        </Card>
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-teal-950">Approved delivery areas</h2>
          <p className="text-sm text-teal-800">
            These are the saved delivery areas and their approved ZIP codes. An approved
            account and a validated address are still required before purchase.
          </p>
          {delivery.zones.length === 0 ? (
            <p className="text-sm text-teal-800">
              No delivery ZIP codes have been approved yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {delivery.zones.map((zone) => (
                <li key={zone.code}>
                  <p className="font-semibold text-teal-950">{zone.name}</p>
                  <p className="text-sm text-teal-800">{zone.towns}</p>
                  <p className="text-sm text-teal-700">{zone.zips.join(", ")}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
