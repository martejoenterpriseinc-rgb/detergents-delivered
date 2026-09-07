import { auth } from "@/auth";
import { hasRole, type RoleCode } from "@/lib/domain/authz";

export async function requireApiRole(allowed: RoleCode[]) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  if (!hasRole(session.user.roles, allowed)) {
    return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { session };
}
