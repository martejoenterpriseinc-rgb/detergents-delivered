import type { ReactNode } from "react";
import { CartProvider } from "@/components/storefront/cart-provider";
import { StorefrontFooter } from "@/components/storefront/footer";
import { StorefrontHeader } from "@/components/storefront/header";
import { getSession } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  return (
    <CartProvider>
      <div className="flex min-h-full flex-col">
        <StorefrontHeader signedIn={Boolean(session?.user?.id)} />
        <main className="flex-1">{children}</main>
        <StorefrontFooter />
      </div>
    </CartProvider>
  );
}
