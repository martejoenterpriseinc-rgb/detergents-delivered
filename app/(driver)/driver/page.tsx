import { Card } from "@/components/ui/card";

export default function DriverHomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-teal-950">Today&apos;s route</h1>
      <Card>
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
          Phase 4
        </p>
        <p className="mt-2 text-sm text-teal-800">
          Driver mode is a shell only. Stops, photos, and mileage capture are
          not implemented. This screen exists so /driver is a first-class mode
          of the same app.
        </p>
      </Card>
    </div>
  );
}
