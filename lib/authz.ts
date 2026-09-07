import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  AuthzError,
  hasPermission,
  hasRole,
  permissionsForRoles,
  requirePermissionSync,
  requireRoleSync,
  type RoleCode,
} from "@/lib/domain/authz";

export { hasPermission, hasRole, requirePermissionSync, requireRoleSync, AuthzError };
export type { RoleCode };

export async function getSession() {
  return auth();
}

export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  return session;
}

export async function requireRole(...allowed: RoleCode[]) {
  const session = await requireAuth();
  if (!hasRole(session.user.roles, allowed)) {
    redirect("/sign-in?error=forbidden");
  }
  return session;
}

export async function requirePermission(permission: string) {
  const session = await requireAuth();
  const granted = permissionsForRoles(session.user.roles);
  if (!hasPermission(granted, permission)) {
    redirect("/sign-in?error=forbidden");
  }
  return session;
}
