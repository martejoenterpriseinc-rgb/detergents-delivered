import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-teal-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandLogo size={40} />
            <div>
              <p className="text-sm font-semibold tracking-tight text-teal-900">
                Detergents Delivered
              </p>
              <p className="text-xs text-teal-700/80">Clean home, local drop-off</p>
            </div>
          </Link>
          <nav className="flex items-center gap-3 text-sm font-medium">
            <Link href="/shop" className="text-teal-800 hover:text-teal-950">
              Shop
            </Link>
            <Link href="/account" className="text-teal-800 hover:text-teal-950">
              Account
            </Link>
            <Link
              href="/sign-in"
              className="rounded-full bg-teal-700 px-4 py-2 text-white hover:bg-teal-800"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-teal-100 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-teal-800 sm:flex-row sm:items-center sm:justify-between">
          <p>Detergents Delivered — household products, brought to your door.</p>
          <p>Household products, local delivery.</p>
        </div>
      </footer>
    </div>
  );
}
