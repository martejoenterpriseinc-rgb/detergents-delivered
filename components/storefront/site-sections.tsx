import Link from "next/link";
import type { ReactNode } from "react";
import type { Route } from "next";
import { BrandLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SiteSectionDraft } from "@/lib/domain/site-content";

function ActionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return <Link href={href as Route}>{children}</Link>;
}

function SectionActions({
  section,
}: {
  section: Pick<SiteSectionDraft, "ctaLabel" | "ctaHref" | "secondaryCtaLabel" | "secondaryCtaHref">;
}) {
  if (!section.ctaLabel && !section.secondaryCtaLabel) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {section.ctaLabel && section.ctaHref ? (
        <ActionLink href={section.ctaHref}>
          <Button size="lg">{section.ctaLabel}</Button>
        </ActionLink>
      ) : null}
      {section.secondaryCtaLabel && section.secondaryCtaHref ? (
        <ActionLink href={section.secondaryCtaHref}>
          <Button size="lg" variant="outline">
            {section.secondaryCtaLabel}
          </Button>
        </ActionLink>
      ) : null}
    </div>
  );
}

function variantClass(styleVariant: SiteSectionDraft["styleVariant"]) {
  if (styleVariant === "emphasis") return "bg-teal-50";
  if (styleVariant === "muted") return "bg-white/70";
  return "bg-white";
}

function HighlightCard({ section }: { section: SiteSectionDraft }) {
  return (
    <Card className={cn("flex flex-col items-center gap-4 text-center", variantClass(section.styleVariant))}>
      <BrandLogo size={96} />
      {section.title ? <p className="text-lg font-semibold text-teal-950">{section.title}</p> : null}
      {section.body ? <p className="text-sm text-teal-800">{section.body}</p> : null}
    </Card>
  );
}

function HeroBlock({ section }: { section: SiteSectionDraft }) {
  return (
    <div className="space-y-6">
      {section.badgeText ? (
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">
          {section.badgeText}
        </p>
      ) : null}
      {section.title ? (
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-teal-950 sm:text-5xl">
          {section.title}
        </h1>
      ) : null}
      {section.body ? (
        <p className="max-w-xl text-lg leading-8 text-teal-900/80">{section.body}</p>
      ) : null}
      <SectionActions section={section} />
    </div>
  );
}

function FeaturesBlock({ section }: { section: SiteSectionDraft }) {
  const points = section.body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <section className={cn("rounded-3xl border border-teal-100 p-6 sm:p-8", variantClass(section.styleVariant))}>
      {section.badgeText ? (
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">
          {section.badgeText}
        </p>
      ) : null}
      {section.title ? (
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold text-teal-950">{section.title}</h2>
      ) : null}
      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {points.map((point) => (
          <li key={point} className="rounded-2xl bg-white/80 p-4 text-sm leading-6 text-teal-900">
            {point}
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <SectionActions section={section} />
      </div>
    </section>
  );
}

function ServiceAreaBlock({
  section,
  counties,
}: {
  section: SiteSectionDraft;
  counties: string[];
}) {
  return (
    <section className={cn("rounded-3xl border border-teal-100 p-6 sm:p-8", variantClass(section.styleVariant))}>
      {section.badgeText ? (
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">
          {section.badgeText}
        </p>
      ) : null}
      {section.title ? (
        <h2 className="mt-3 text-2xl font-semibold text-teal-950">{section.title}</h2>
      ) : null}
      {section.body ? <p className="mt-3 max-w-2xl text-teal-900/80">{section.body}</p> : null}
      <ul className="mt-6 flex flex-wrap gap-2">
        {counties.map((county) => (
          <li
            key={county}
            className="rounded-full bg-teal-700 px-4 py-2 text-sm font-medium text-white"
          >
            {county}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CtaBlock({ section }: { section: SiteSectionDraft }) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-teal-100 p-6 text-center sm:p-10",
        variantClass(section.styleVariant),
      )}
    >
      {section.title ? (
        <h2 className="text-2xl font-semibold text-teal-950 sm:text-3xl">{section.title}</h2>
      ) : null}
      {section.body ? (
        <p className="mx-auto mt-3 max-w-xl text-teal-900/80">{section.body}</p>
      ) : null}
      <div className="mt-6 flex justify-center">
        <SectionActions section={section} />
      </div>
    </section>
  );
}

export function SiteSectionView({
  section,
  counties,
}: {
  section: SiteSectionDraft;
  counties: string[];
}) {
  if (section.type === "hero") return <HeroBlock section={section} />;
  if (section.type === "highlight") return <HighlightCard section={section} />;
  if (section.type === "features") return <FeaturesBlock section={section} />;
  if (section.type === "service-area") {
    return <ServiceAreaBlock section={section} counties={counties} />;
  }
  return <CtaBlock section={section} />;
}

export function SiteSections({
  sections,
  counties,
}: {
  sections: SiteSectionDraft[];
  counties: string[];
}) {
  const visible = sections
    .filter((section) => section.visible)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const nodes: ReactNode[] = [];
  for (let index = 0; index < visible.length; index += 1) {
    const section = visible[index]!;
    const next = visible[index + 1];
    if (section.type === "hero" && next?.type === "highlight") {
      nodes.push(
        <section
          key={`${section.sectionId}-${next.sectionId}`}
          className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]"
        >
          <SiteSectionView section={section} counties={counties} />
          <SiteSectionView section={next} counties={counties} />
        </section>,
      );
      index += 1;
      continue;
    }
    nodes.push(
      <SiteSectionView key={section.sectionId} section={section} counties={counties} />,
    );
  }

  return <div className="space-y-10">{nodes}</div>;
}
