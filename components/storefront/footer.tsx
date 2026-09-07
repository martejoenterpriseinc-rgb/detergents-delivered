import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";

const FOOTER_LINKS = [
  { href: "/shop", label: "Shop" },
  { href: "/delivery-area", label: "Delivery area" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/referrals", label: "Referrals" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
] as const;

export function StorefrontFooter() {
  return (
    <footer className="border-t border-teal-100 bg-white">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <BrandLogo size={36} />
            <p className="text-sm font-semibold text-teal-950">Detergents Delivered</p>
          </div>
          <p className="max-w-md text-sm leading-6 text-teal-800">
            Household detergent, dish, paper, and cleaning staples — packed locally and
            brought to your door. No warehouse-club haul. No membership required.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-2 text-sm">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-teal-800 hover:text-teal-950"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-teal-100">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-teal-700 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Detergents Delivered. All rights reserved.</p>
          <p>Storefront mockup — payments, SMS, and live routing are not connected.</p>
        </div>
      </div>
    </footer>
  );
}
