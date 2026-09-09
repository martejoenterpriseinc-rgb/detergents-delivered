"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Truck,
  Users,
  Package,
  ShoppingBag,
  Gift,
  Headphones,
  Settings,
  ArrowUpRight,
  ChevronDown,
  Box,
  BarChart3,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/logo";
import { visibleAdminNav } from "@/lib/admin-nav";
const navIcon = (href: string) =>
  href === "/admin"
    ? LayoutDashboard
    : href.includes("deliveries") || href.includes("routes")
      ? Truck
      : href.includes("customers")
        ? Users
        : href.includes("loyalty")
          ? Gift
          : href.includes("support")
            ? Headphones
            : href.includes("settings")
              ? Settings
              : href.includes("products") || href.includes("inventory")
                ? Package
                : href.includes("reports")
                  ? BarChart3
                  : href.includes("orders")
                    ? ShoppingBag
                    : Box;
export function AdminShell({
  children,
  email,
  roles = [],
}: {
  children: ReactNode;
  email?: string | null;
  roles?: readonly string[];
}) {
  const path = usePathname();
  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <Link href="/admin" className="ops-brand">
          <BrandLogo size={44} />
          <span>BUSINESS ADMIN</span>
        </Link>
        <div className="ops-nav-label">WORKSPACE</div>
        <nav aria-label="Admin navigation">
          {visibleAdminNav(roles).map((item) => {
            const Icon = navIcon(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  path === item.href ||
                  (item.href !== "/admin" && path.startsWith(item.href + "/"))
                    ? "selected"
                    : ""
                }
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ops-sidebar-bottom">
          <span className="ops-brand-dot" />
          Detergents Delivered<small>Local delivery. Everyday value.</small>
        </div>
      </aside>
      <div className="ops-workspace">
        <header className="ops-topbar">
          <span className="ops-topbar-title">
            Detergents Delivered <span>/</span> Admin
          </span>
          <div className="ops-topbar-actions">
            <Link href="/account">
              View as customer
              <ArrowUpRight size={15} />
            </Link>
            <span className="ops-topbar-divider" />
            <span className="ops-avatar">{email?.slice(0, 2).toUpperCase() ?? "DD"}</span>
            <div className="ops-identity">
              <strong>{email ?? "Signed in"}</strong>
              <small>
                {roles.includes("SUPER_ADMIN") ? "Owner / Admin" : "Team member"}
              </small>
            </div>
            <ChevronDown size={14} />
          </div>
        </header>
        <main className="ops-main">{children}</main>
      </div>
    </div>
  );
}
