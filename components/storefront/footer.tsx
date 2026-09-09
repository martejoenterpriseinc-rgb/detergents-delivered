import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import {
  DEFAULT_SITE_SETTINGS,
  siteImageUrl,
  type SiteSettings,
} from "@/lib/domain/site-content";
export function StorefrontFooter({
  settings = DEFAULT_SITE_SETTINGS,
}: {
  settings?: SiteSettings;
}) {
  return (
    <footer className="sf-footer" data-site-area="footer">
      <div className="sf-container sf-footer-grid">
        <div>
          <div
            className={`sf-brand ${settings.logoId === "builtin:logo" ? "sf-brand-wordmark" : ""}`}
          >
            {settings.logoId && (
              <Image
                unoptimized={!settings.logoId.startsWith("builtin:")}
                src={siteImageUrl(settings.logoId)}
                width={64}
                height={48}
                alt=""
              />
            )}
            <strong>{settings.brandName}</strong>
          </div>
          <p>{settings.footerText}</p>
        </div>
        <nav aria-label="Footer">
          {settings.footerLinks.map((n, i) => (
            <Link key={i} href={n.href as Route}>
              {n.label}
            </Link>
          ))}
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Refunds</Link>
        </nav>
      </div>
      <div className="sf-container sf-copyright">
        © {new Date().getFullYear()} {settings.copyrightText}
      </div>
    </footer>
  );
}
