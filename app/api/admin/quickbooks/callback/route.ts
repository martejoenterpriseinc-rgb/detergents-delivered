import { accountRequest } from "@/lib/account-api";
import { completeQuickbooksConnection } from "@/lib/services/quickbooks-connection";
import { applicationOrigin } from "@/lib/integration-environment";
export async function GET(request: Request) {
  const origin = applicationOrigin(
    process.env.AUTH_URL,
    process.env.APP_ENV === "development",
  );
  if (!origin) return new Response("Connection unavailable.", { status: 503 });
  let status = "failed";
  try {
    const actor = await accountRequest(),
      query = new URL(request.url).searchParams;
    if (query.has("error")) throw new Error();
    await completeQuickbooksConnection(actor, {
      state: query.get("state"),
      code: query.get("code"),
      realmId: query.get("realmId"),
    });
    status = "connected";
  } catch {}
  return new Response(null, {
    status: 303,
    headers: {
      Location: origin + "/admin/reports/quickbooks?connection=" + status,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
