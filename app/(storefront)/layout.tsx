import type { ReactNode } from "react";
import { StorefrontChrome } from "@/components/storefront/chrome";
import { getSession } from "@/lib/authz";
import { getPublishedHomePage } from "@/lib/services/site-content";
import { storefrontLaunchNotice } from "@/lib/services/storefront-home";
export const dynamic = "force-dynamic";
export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const [session, { page }, launchNotice] = await Promise.all([
    getSession(),
    getPublishedHomePage(),
    storefrontLaunchNotice(),
  ]);
  return (
    <StorefrontChrome
      settings={page.settings}
      signedIn={Boolean(session?.user?.id)}
      launchNotice={launchNotice}
    >
      {children}
    </StorefrontChrome>
  );
}
