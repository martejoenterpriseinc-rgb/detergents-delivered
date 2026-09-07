import type { ReactNode } from "react";

export function LegalPage({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-teal-950">{title}</h1>
      <p className="mt-3 text-lg leading-8 text-teal-800">{lede}</p>
      <div className="prose-dd mt-8 space-y-6 text-sm leading-7 text-teal-900">
        {children}
      </div>
    </article>
  );
}
