import { after } from "next/server";
import {
  getDeliveryCoverage,
  refreshCoverageLocations,
} from "@/lib/services/delivery-coverage";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const coverage = await getDeliveryCoverage();
    after(async () => {
      try {
        await refreshCoverageLocations();
      } catch {
        /* The next request retries. Checkout never depends on map lookups. */
      }
    });
    return Response.json(coverage, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Delivery area is temporarily unavailable. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
