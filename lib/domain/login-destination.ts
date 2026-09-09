import { ADMIN_SHELL_ROLES, hasRole } from "./authz";
export function loginDestination(roles: readonly string[]) {
  return hasRole(roles, ADMIN_SHELL_ROLES) ? "/admin" : "/account";
}
export function safeLoginCallback(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return "/account/entry";
  return value;
}
