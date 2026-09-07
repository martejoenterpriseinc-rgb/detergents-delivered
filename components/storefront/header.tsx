"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, ShoppingBag, X } from "lucide-react";
import { BrandLogo } from "@/components/brand/logo";
import { useCart } from "@/components/storefront/cart-provider";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/shop", label: "Shop" },
  { href: "/delivery-area", label: "Delivery area" },
  { href: "/faq", label: "FAQ" },
  { href: "/account", label: "Account" },
] as const;

export function StorefrontHeader({ signedIn }: { signedIn: boolean }) {
  const { itemCount } = useCart();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-teal-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3"
          onClick={() => setOpen(false)}
        >
          <BrandLogo size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-teal-900">
              Detergents Delivered
            </p>
            <p className="hidden text-xs text-teal-700/80 sm:block">
              Household staples, to your door
            </p>
          </div>
        </Link>
        <nav className="hidden items-center gap-5 text-sm font-medium md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-teal-800 hover:text-teal-950"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/cart"
            className="relative inline-flex h-11 items-center gap-2 rounded-full border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-900 hover:bg-teal-50"
          >
            <ShoppingBag className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Cart</span>
            <span
              className={cn(
                "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs",
                itemCount > 0 ? "bg-teal-700 text-white" : "bg-teal-100 text-teal-800",
              )}
            >
              {itemCount}
            </span>
          </Link>
          <Link
            href={signedIn ? "/account" : "/sign-in"}
            className="hidden rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 sm:inline-flex"
          >
            {signedIn ? "Account" : "Sign in"}
          </Link>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-teal-200 text-teal-900 md:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open ? (
        <div className="border-t border-teal-100 bg-white px-4 py-3 md:hidden">
          <nav className="grid gap-2 text-sm font-medium">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-2xl px-3 py-2 text-teal-900 hover:bg-teal-50"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={signedIn ? "/account" : "/sign-in"}
              className="rounded-2xl bg-teal-700 px-3 py-2 text-white"
              onClick={() => setOpen(false)}
            >
              {signedIn ? "Your account" : "Sign in"}
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
