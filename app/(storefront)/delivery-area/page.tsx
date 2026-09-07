import { Card } from "@/components/ui/card";
import { DeliveryChecker } from "@/components/storefront/delivery-checker";
import { DEMO_DELIVERY_ZONES } from "@/lib/delivery-area";

export default function DeliveryAreaPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold text-teal-950">Delivery area</h1>
      <p className="mt-2 max-w-2xl text-lg text-teal-800">
        We cover a defined metro, not the whole country. Enter your ZIP to see if a demo
        route reaches your porch.
      </p>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-teal-950">Check your ZIP</h2>
          <DeliveryChecker />
        </Card>
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-teal-950">Demo zones</h2>
          <p className="text-sm text-teal-800">
            These ZIPs always succeed in the mockup so you can walk the checkout path.
            Live zone capacity comes in a later phase.
          </p>
          <ul className="space-y-3">
            {DEMO_DELIVERY_ZONES.map((zone) => (
              <li key={zone.name}>
                <p className="font-semibold text-teal-950">{zone.name}</p>
                <p className="text-sm text-teal-800">{zone.zips.join(", ")}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
