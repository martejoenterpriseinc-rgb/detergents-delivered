import { auth } from "@/auth";
import { hasRole, type RoleCode } from "@/lib/domain/authz";
import { staffAccessDeniedReason } from "@/lib/domain/credentials";
import { userMustChangeCredentials } from "@/lib/authz";

export async function requireApiRole(allowed: RoleCode[]) {
  const session = await auth();
  const userId = session?.user?.id;
  const mustChangeCredentials = userId
    ? await userMustChangeCredentials(userId)
    : Boolean(session?.user?.mustChangeCredentials);

  const reason = staffAccessDeniedReason({
    authenticated: Boolean(userId),
    hasAllowedRole: hasRole(session?.user?.roles ?? [], allowed),
    mustChangeCredentials,
  });

  if (reason === "unauthenticated") {
    return { error: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  if (reason === "credentials_change_required") {
    return {
      error: Response.json({ error: "credentials_change_required" }, { status: 403 }),
    };
  }
  if (reason === "forbidden") {
    return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { session: session! };
}
