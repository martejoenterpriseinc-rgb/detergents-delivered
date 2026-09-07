import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { ADMIN_NAV } from "@/lib/admin-nav";

export function AdminShell({
  children,
  email,
}: {
  children: ReactNode;
  email?: string | null;
}) {
  return (
    <div className="min-h-full bg-teal-50/60 lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="border-b border-teal-100 bg-white lg:min-h-full lg:border-r lg:border-b-0">
        <div className="flex items-center gap-3 px-4 py-4">
          <BrandLogo size={32} className="max-w-[11rem] sm:max-w-[13rem]" />
          <p className="text-sm font-semibold text-teal-950">Admin</p>
        </div>
        <nav className="grid max-h-[50vh] grid-cols-2 gap-1 overflow-auto px-3 pb-4 sm:grid-cols-3 lg:max-h-none lg:grid-cols-1">
          {ADMIN_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl px-3 py-2 text-sm text-teal-900 hover:bg-teal-50"
            >
              <span>{item.label}</span>
              {!item.ready ? (
                <span className="ml-2 text-[10px] tracking-wide text-teal-600 uppercase">
                  Phase {item.phase}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-teal-100 bg-white px-4 py-3">
          <p className="text-sm text-teal-800">{email ?? "Signed in"}</p>
          <Link href="/" className="text-sm font-medium text-teal-800">
            Storefront
          </Link>
        </header>
        <div className="p-4 sm:p-8">{children}</div>
      </div>
    </div>
  );
}
