export const ROLE_CODES = [
  "CUSTOMER",
  "ADMIN",
  "INVENTORY",
  "DRIVER",
  "CPA",
  "SUPER_ADMIN",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export const STAFF_ROLES: RoleCode[] = [
  "ADMIN",
  "INVENTORY",
  "DRIVER",
  "CPA",
  "SUPER_ADMIN",
];

export const ADMIN_SHELL_ROLES: RoleCode[] = [
  "ADMIN",
  "INVENTORY",
  "CPA",
  "SUPER_ADMIN",
];

export const DRIVER_SHELL_ROLES: RoleCode[] = ["DRIVER", "ADMIN", "SUPER_ADMIN"];

export const ROLE_PERMISSIONS: Record<RoleCode, readonly string[]> = {
  CUSTOMER: ["catalog.read"],
  ADMIN: [
    "catalog.read",
    "catalog.write",
    "orders.read",
    "orders.write",
    "inventory.read",
    "routes.read",
    "routes.write",
    "finance.read",
    "settings.write",
  ],
  INVENTORY: ["catalog.read", "catalog.write", "inventory.read", "inventory.write"],
  DRIVER: ["routes.read", "routes.write"],
  CPA: ["finance.read", "orders.read", "inventory.read", "catalog.read"],
  SUPER_ADMIN: ["*"],
};

export function permissionsForRoles(roles: readonly string[]): string[] {
  const granted = new Set<string>();
  for (const role of roles) {
    const mapped = ROLE_PERMISSIONS[role as RoleCode];
    if (!mapped) continue;
    for (const permission of mapped) {
      granted.add(permission);
    }
  }
  return [...granted];
}

export function hasRole(roles: readonly string[], allowed: readonly RoleCode[]): boolean {
  if (roles.includes("SUPER_ADMIN")) {
    return true;
  }
  return allowed.some((role) => roles.includes(role));
}

export function requireRoleSync(
  roles: readonly string[],
  allowed: readonly RoleCode[],
): void {
  if (!hasRole(roles, allowed)) {
    throw new AuthzError(`requires one of: ${allowed.join(", ")}`);
  }
}

export function hasPermission(
  granted: readonly string[],
  needed: string,
): boolean {
  return granted.includes("*") || granted.includes(needed);
}

export function requirePermissionSync(
  granted: readonly string[],
  needed: string,
): void {
  if (!hasPermission(granted, needed)) {
    throw new AuthzError(`missing permission: ${needed}`);
  }
}

export class AuthzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthzError";
  }
}
