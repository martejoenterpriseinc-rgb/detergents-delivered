import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import {
  getPublicDeliveryInfo,
  saveDeliverySettings,
} from "@/lib/services/delivery-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await getPublicDeliveryInfo();
  return Response.json({
    settings: info.settings,
    public: {
      enabledCountyCodes: info.enabledCountyCodes,
      enabledCountyNames: info.enabledCountyNames,
      serviceAreaSummary: info.serviceAreaSummary,
      weeklySummary: info.weeklySummary,
      nextWindowLabel: info.nextWindowLabel,
      exampleZip: info.exampleZip,
      noSameDaySummary: info.noSameDaySummary,
    },
  });
}

export async function PUT(request: Request) {
  const gate = await requireApiRole(["ADMIN", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;

  const body = await request.json().catch(() => null);
  try {
    const settings = await saveDeliverySettings(body, gate.session.user.id);
    return Response.json({ settings });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
