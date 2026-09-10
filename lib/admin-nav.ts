import type { Route } from "next";
import { hasRole, type RoleCode } from "@/lib/domain/authz";

export type AdminNavItem = {
  href: Route;
  label: string;
  phase: number;
  ready?: boolean;
  roles?: RoleCode[];
};

const admins: RoleCode[] = ["ADMIN", "SUPER_ADMIN"];
const stock: RoleCode[] = ["ADMIN", "INVENTORY", "SUPER_ADMIN"];
const stockReaders: RoleCode[] = [...stock, "CPA"];
export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", phase: 1 },
  { href: "/admin/orders", label: "Orders", phase: 3 },
  { href: "/admin/deliveries", label: "Deliveries", phase: 4, roles: admins },
  { href: "/admin/customers", label: "Customers", phase: 3, roles: admins },
  { href: "/admin/inventory", label: "Inventory", phase: 2 },
  { href: "/admin/receiving", label: "Receiving", phase: 2, roles: stockReaders },
  { href: "/admin/website", label: "Website", phase: 2, roles: admins },
  { href: "/admin/payments", label: "Payments", phase: 3, roles: admins },
  { href: "/admin/reports", label: "Reports", phase: 8 },
  { href: "/admin/settings", label: "Settings", phase: 1 },
];
const action = (href: Route, label: string, roles?: RoleCode[]): AdminNavItem => ({
  href,
  label,
  roles,
  phase: 1,
});
export const WORKSPACE_ACTIONS: Record<string, AdminNavItem[]> = {
  "/admin/customers": [
    action("/admin/customers", "Customers", admins),
    action("/admin/support", "Customer support", admins),
    action("/admin/loyalty", "Loyalty program", admins),
  ],
  "/admin/inventory": [
    action("/admin/inventory", "Inventory"),
    action("/admin/products", "Products"),
    action("/admin/categories", "Categories", stock),
    action("/admin/shop", "Shop online", stock),
    action("/admin/categories", "+ Category", stock),
    action("/admin/products/new", "+ Item", stock),
  ],
  "/admin/receiving": [
    action("/admin/receiving", "Receiving", stockReaders),
    action("/admin/purchase-orders", "Purchase orders", stockReaders),
    action("/admin/purchase-orders/new", "+ Purchase order", stock),
    action("/admin/vendors", "Vendors", stockReaders),
    action("/admin/vendors/new", "+ Vendor", stock),
  ],
  "/admin/reports": [
    action("/admin/reports", "Reports"),
    action("/admin/cpa", "CPA center"),
    action("/admin/import-export", "Import / export"),
    action("/admin/expenses", "Expenses", [...admins, "CPA"]),
    action("/admin/mileage", "Mileage", [...admins, "CPA"]),
    action("/admin/taxes", "Taxes"),
  ],
  "/admin/settings": [
    action("/admin/settings", "Settings"),
    action("/admin/settings/launch", "Launch & capacity", admins),
    action("/admin/integrations", "Integrations", admins),
    action("/admin/customers/approvals", "Address approvals", admins),
    action("/admin/settings/business/setup", "Business setup", admins),
    action("/admin/settings/business/documents", "Business documents", admins),
  ],
};
export function adminWorkspace(path: string): string {
  const matches = Object.entries(WORKSPACE_ACTIONS).flatMap(([parent, items]) =>
    items.map((item) => ({ parent, href: item.href })),
  );
  return (
    matches
      .sort((a, b) => b.href.length - a.href.length)
      .find((item) => path === item.href || path.startsWith(item.href + "/"))?.parent ??
    ADMIN_NAV.find((item) => item.href !== "/admin" && path.startsWith(item.href + "/"))
      ?.href ??
    path
  );
}
export function workspaceActions(path: string, roles: readonly string[]) {
  return (WORKSPACE_ACTIONS[adminWorkspace(path)] ?? []).filter(
    (item) => !item.roles || hasRole(roles, item.roles),
  );
}
export function visibleAdminNav(roles: readonly string[]) {
  return ADMIN_NAV.filter((item) => !item.roles || hasRole(roles, item.roles));
}
