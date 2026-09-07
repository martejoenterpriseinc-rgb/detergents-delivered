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
  { href: "/admin/routes", label: "Routes", phase: 4 },
  { href: "/admin/customers", label: "Customers", phase: 3 },
  { href: "/admin/products", label: "Products", phase: 2, ready: true },
  { href: "/admin/categories", label: "Categories", phase: 2, ready: true },
  { href: "/admin/inventory", label: "Inventory", phase: 2, ready: true },
  { href: "/admin/purchase-orders", label: "Purchase Orders", phase: 2, ready: true },
  { href: "/admin/receiving", label: "Receiving", phase: 2, ready: true },
  { href: "/admin/vendors", label: "Vendors", phase: 2, ready: true },
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
