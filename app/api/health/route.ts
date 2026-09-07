import { getAppEnv } from "@/lib/env";

export async function GET() {
  return Response.json({
    ok: true,
    service: "detergents-delivered",
    env: getAppEnv(),
    timestamp: new Date().toISOString(),
  });
}
