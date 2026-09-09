import Link from "next/link";
import { launchConfig } from "@/lib/services/launch";
import type { ReactNode } from "react";
import { CartProvider } from "@/components/storefront/cart-provider";
import { StorefrontFooter } from "@/components/storefront/footer";
import { StorefrontHeader } from "@/components/storefront/header";
import { getSession } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const launch = await launchConfig();

  return (
    <CartProvider>
      <div className="flex min-h-full flex-col">
        <StorefrontHeader signedIn={Boolean(session?.user?.id)} />
        {launch.enabled && (
          <div className="border-b border-teal-100 bg-teal-50 px-4 py-4 text-center text-sm">
            Planned launch: {launch.launchDate}. First delivery window:{" "}
            {launch.launchDate}–{launch.firstDeliveryBy}. Exact delivery dates will be
            confirmed after routes are reviewed. Ordering is not open yet.{" "}
            <Link href="/contact" className="font-semibold underline">
              Tell us you’re interested
            </Link>
          </div>
        )}
        <main className="flex-1">{children}</main>
        <StorefrontFooter />
      </div>
    </CartProvider>
  );
}
