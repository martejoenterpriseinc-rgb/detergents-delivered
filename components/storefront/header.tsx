"use client";
import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { useState } from "react";
import { Menu, ShoppingBag, X } from "lucide-react";
import { useCart } from "@/components/storefront/cart-provider";
import {
  DEFAULT_SITE_SETTINGS,
  siteImageUrl,
  type SiteSettings,
} from "@/lib/domain/site-content";
export function StorefrontHeader({
  signedIn,
  settings = DEFAULT_SITE_SETTINGS,
}: {
  signedIn: boolean;
  settings?: SiteSettings;
}) {
  const { itemCount } = useCart();
  const [open, setOpen] = useState(false);
  return (
    <header className="sf-header" data-site-area="header">
      <div className="sf-container sf-header-row">
        <Link
          href="/"
          className={`sf-brand ${settings.logoId === "builtin:logo" ? "sf-brand-wordmark" : ""}`}
          onClick={() => setOpen(false)}
          aria-label={`${settings.brandName} home`}
        >
          {/* Uploaded logos are served by the same authenticated/public media handler as photos. */}

          {settings.logoId && (
            <Image
              unoptimized={!settings.logoId.startsWith("builtin:")}
              src={siteImageUrl(settings.logoId)}
              alt=""
              width={64}
              height={48}
            />
          )}
          <span>
            <strong>{settings.brandName}</strong>
            <small>{settings.tagline}</small>
          </span>
        </Link>
        <nav className="sf-desktop-nav" aria-label="Primary">
          {settings.navigation.map((n, i) => (
            <Link key={i} href={n.href as Route}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sf-header-actions">
          <Link href={signedIn ? "/account" : "/sign-in"} className="sf-login">
            {signedIn ? "Account" : "Sign in"}
          </Link>
          <Link href="/cart" className="sf-cart" aria-label={`Cart, ${itemCount} items`}>
            <ShoppingBag size={18} aria-hidden />
            <span className="sf-cart-label">Cart</span>
            <span className="sf-cart-count">{itemCount}</span>
          </Link>
          <button
            type="button"
            className="sf-menu"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="sf-mobile-nav sf-container" aria-label="Mobile navigation">
          {settings.navigation.map((n, i) => (
            <Link key={i} href={n.href as Route} onClick={() => setOpen(false)}>
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
