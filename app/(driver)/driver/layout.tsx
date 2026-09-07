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
        <div className="flex items-center gap-3">
          <BrandLogo size={36} />
          <div>
            <p className="text-sm font-semibold">Driver</p>
            <p className="text-xs text-teal-100">{session.user.email}</p>
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
