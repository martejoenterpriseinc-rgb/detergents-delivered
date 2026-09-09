import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { CartProvider } from "./cart-provider";
import { StorefrontHeader } from "./header";
import { StorefrontFooter } from "./footer";
import type { SiteSettings } from "@/lib/domain/site-content";
export function StorefrontChrome({
  settings,
  signedIn,
  launchNotice,
  children,
}: {
  settings: SiteSettings;
  signedIn: boolean;
  launchNotice: string;
  children: ReactNode;
}) {
  return (
    <CartProvider>
      <div className={`sf-site sf-theme-${settings.theme}`}>
        <div data-site-area="announcement">
          {settings.announcement && (
            <div className="sf-announcement">
              {settings.announcementHref ? (
                <Link href={settings.announcementHref as Route}>
                  {settings.announcement}
                </Link>
              ) : (
                settings.announcement
              )}
            </div>
          )}
        </div>
        <StorefrontHeader settings={settings} signedIn={signedIn} />
        {launchNotice && <div className="sf-launch-notice">{launchNotice}</div>}
        <main>{children}</main>
        <StorefrontFooter settings={settings} />
      </div>
    </CartProvider>
  );
}
