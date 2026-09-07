import type { Route } from "next";

export type AdminNavItem = {
  href: Route;
  label: string;
  phase: number;
  ready?: boolean;
};

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", phase: 1, ready: true },
  { href: "/admin/orders", label: "Orders", phase: 3 },
  { href: "/admin/routes", label: "Routes", phase: 5 },
  { href: "/admin/customers", label: "Customers", phase: 3 },
  { href: "/admin/products", label: "Products", phase: 2, ready: true },
  { href: "/admin/inventory", label: "Inventory", phase: 4 },
  { href: "/admin/purchase-orders", label: "Purchase Orders", phase: 4 },
  { href: "/admin/receiving", label: "Receiving", phase: 4 },
  { href: "/admin/vendors", label: "Vendors", phase: 4 },
  { href: "/admin/payments", label: "Payments", phase: 3 },
  { href: "/admin/expenses", label: "Expenses", phase: 7 },
  { href: "/admin/mileage", label: "Mileage", phase: 5 },
  { href: "/admin/taxes", label: "Taxes", phase: 7 },
  { href: "/admin/reports", label: "Reports", phase: 8 },
  { href: "/admin/cpa", label: "CPA Center", phase: 7 },
  { href: "/admin/import-export", label: "Import/Export", phase: 8 },
  { href: "/admin/integrations", label: "Integrations", phase: 7 },
  { href: "/admin/settings", label: "Settings", phase: 1, ready: true },
];
