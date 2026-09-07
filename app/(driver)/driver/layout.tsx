import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { requireRole } from "@/lib/authz";
import { DRIVER_SHELL_ROLES } from "@/lib/domain/authz";

export const dynamic = "force-dynamic";

export default async function DriverLayout({ children }: { children: ReactNode }) {
  const session = await requireRole(...DRIVER_SHELL_ROLES);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col bg-teal-50">
      <header className="flex items-center justify-between bg-teal-800 px-4 py-4 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-lg bg-white px-2 py-1">
            <BrandLogo
              size={28}
              className="h-7 max-w-[10.5rem] sm:h-8 sm:max-w-[12rem]"
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Driver</p>
            <p className="truncate text-xs text-teal-100">{session.user.email}</p>
          </div>
        </div>
        <Link href="/" className="text-xs font-medium text-teal-100">
          Storefront
        </Link>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
