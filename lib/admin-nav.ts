import type { Route } from "next";
import { hasRole, type RoleCode } from "@/lib/domain/authz";

export type AdminNavItem = {
  href: Route;
  label: string;
  phase: number;
  ready?: boolean;
  roles?: RoleCode[];
};

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", phase: 1, ready: true },
  { href: "/admin/orders", label: "Orders", phase: 3 },
  {
    href: "/admin/deliveries",
    label: "Deliveries",
    phase: 4,
    ready: true,
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
  {
    href: "/admin/support",
    label: "Customer support",
    phase: 3,
    ready: true,
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
  {
    href: "/admin/loyalty",
    label: "Loyalty program",
    phase: 5,
    ready: true,
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
  {
    href: "/admin/customers",
    label: "Customers",
    phase: 3,
    ready: true,
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
  { href: "/admin/products", label: "Products", phase: 2, ready: true },
  { href: "/admin/categories", label: "Categories", phase: 2, ready: true },
  { href: "/admin/inventory", label: "Inventory", phase: 2, ready: true },
  { href: "/admin/purchase-orders", label: "Purchase Orders", phase: 2, ready: true },
  { href: "/admin/receiving", label: "Receiving", phase: 2, ready: true },
  { href: "/admin/vendors", label: "Vendors", phase: 2, ready: true },
  {
    href: "/admin/website",
    label: "Website",
    phase: 2,
    ready: true,
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
  { href: "/admin/payments", label: "Payments", phase: 3 },
  { href: "/admin/expenses", label: "Expenses", phase: 6 },
  { href: "/admin/mileage", label: "Mileage", phase: 6 },
  { href: "/admin/taxes", label: "Taxes", phase: 3 },
  { href: "/admin/reports", label: "Reports", phase: 8 },
  { href: "/admin/cpa", label: "CPA Center", phase: 6 },
  { href: "/admin/import-export", label: "Import/Export", phase: 7 },
  { href: "/admin/integrations", label: "Integrations", phase: 7 },
  { href: "/admin/settings", label: "Settings", phase: 1, ready: true },
];

export function visibleAdminNav(roles: readonly string[]) {
  return ADMIN_NAV.filter((item) => !item.roles || hasRole(roles, item.roles));
}
