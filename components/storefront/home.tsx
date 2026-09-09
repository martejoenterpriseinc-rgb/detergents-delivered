import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import type { ComponentProps, CSSProperties } from "react";
import { ProductCard } from "./product-card";
import { DeliveryChecker } from "./delivery-checker";
import { DeliveryMap } from "./delivery-map";
import {
  siteImageUrl,
  type SiteSectionDraft,
  type SiteDocument,
} from "@/lib/domain/site-content";
import type { DeliveryCoverage } from "@/lib/domain/delivery-coverage";
export type HomeProduct = ComponentProps<typeof ProductCard>["product"];
function Photo({ section }: { section: SiteSectionDraft }) {
  if (!section.imageId) return null;
  // Same URL and sizing in the storefront and device preview. No preview-only placeholder.

  return (
    <Image
      unoptimized={!section.imageId.startsWith("builtin:")}
      className={`sf-section-photo sf-fit-${section.imageFit ?? "cover"}`}
      src={siteImageUrl(section.imageId)}
      alt={section.imageAlt ?? ""}
      width={1200}
      height={800}
      style={
        {
          "--photo-position": `${section.imagePositionX ?? 50}% ${section.imagePositionY ?? 50}%`,
          "--photo-mobile-position": `${section.mobileImagePositionX ?? 50}% ${section.mobileImagePositionY ?? 50}%`,
        } as CSSProperties
      }
      loading={section.type === "hero" ? "eager" : "lazy"}
    />
  );
}
function Actions({ section: s }: { section: SiteSectionDraft }) {
  return (s.ctaLabel && s.ctaHref) || (s.secondaryCtaLabel && s.secondaryCtaHref) ? (
    <div className="sf-actions">
      {s.ctaLabel && s.ctaHref && (
        <Link className="sf-button" href={s.ctaHref as Route}>
          {s.ctaLabel}
        </Link>
      )}
      {s.secondaryCtaLabel && s.secondaryCtaHref && (
        <Link
          className="sf-button sf-button-secondary"
          href={s.secondaryCtaHref as Route}
        >
          {s.secondaryCtaLabel}
        </Link>
      )}
    </div>
  ) : null;
}
export function StorefrontHome({
  document,
  products,
  coverage,
}: {
  document: SiteDocument;
  products: HomeProduct[];
  coverage: DeliveryCoverage;
}) {
  return (
    <div className="sf-home">
      {document.sections
        .filter((s) => s.visible)
        .map((section) => {
          const s = section,
            isHero = s.type === "hero";
          return (
            <section
              key={s.sectionId}
              id={s.sectionId}
              data-site-area={s.sectionId}
              className={`sf-section sf-${s.type} sf-style-${s.styleVariant} sf-align-${s.alignment ?? "left"} sf-spacing-${s.spacing ?? "normal"}`}
            >
              <div
                className={`sf-container ${isHero && s.imageId ? "sf-hero-grid" : ""}`}
              >
                <div className="sf-copy">
                  {s.badgeText && <p className="sf-eyebrow">{s.badgeText}</p>}
                  {s.title && (isHero ? <h1>{s.title}</h1> : <h2>{s.title}</h2>)}
                  {s.body && s.type !== "steps" && <p className="sf-body">{s.body}</p>}
                  {isHero && (
                    <div className="sf-hero-check">
                      <DeliveryChecker />
                    </div>
                  )}
                  <Actions section={s} />
                </div>
                {s.imageId && <Photo section={s} />}
                {s.type === "products" && (
                  <div className="sf-products">
                    {products.length ? (
                      products.map((p) => <ProductCard key={p.id} product={p} />)
                    ) : (
                      <p className="sf-empty-products">
                        We’re preparing the next restock. Check back soon for available
                        essentials.
                      </p>
                    )}
                  </div>
                )}
                {s.type === "steps" && (
                  <div className="sf-steps">
                    {s.body
                      .split("\n")
                      .filter(Boolean)
                      .map((step, i) => {
                        const [title, ...body] = step.split("|");
                        return (
                          <article key={i}>
                            <span>{String(i + 1).padStart(2, "0")}</span>
                            <h3>{title.trim()}</h3>
                            <p>{body.join("|").trim()}</p>
                          </article>
                        );
                      })}
                  </div>
                )}
                {s.type === "highlight" && (
                  <div className="sf-inline-check">
                    <DeliveryChecker />
                  </div>
                )}
                {s.type === "service-area" && (
                  <div className="sf-coverage-grid">
                    <DeliveryMap initial={coverage} />
                    <DeliveryChecker />
                  </div>
                )}
              </div>
            </section>
          );
        })}
    </div>
  );
}
