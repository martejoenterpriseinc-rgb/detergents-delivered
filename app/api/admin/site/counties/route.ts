import { requireApiRole } from "@/lib/api-auth";
import { serviceErrorResponse } from "@/lib/api-errors";
import { WEBSITE_MANAGER_ROLES } from "@/lib/domain/site-content";
import { getServiceCounties } from "@/lib/services/site-content";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiRole([...WEBSITE_MANAGER_ROLES]);
  if (gate.error) return gate.error;

  try {
    const counties = await getServiceCounties();
    return Response.json({
      counties,
      editPath: "/admin/settings",
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
