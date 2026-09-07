"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/admin/field";
import { SiteSectionView } from "@/components/storefront/site-sections";
import { adminFetch } from "@/lib/admin-fetch";
import { cn } from "@/lib/utils";
import {
  SITE_SECTION_TYPES,
  SITE_STYLE_VARIANTS,
  collectDraftCopy,
  findForbiddenDefaultCopy,
  type SiteSectionDraft,
  type SiteSectionType,
} from "@/lib/domain/site-content";

type BuilderSection = SiteSectionDraft & {
  id?: string;
};

function newSection(type: SiteSectionType, sortOrder: number): BuilderSection {
  return {
    sectionId: `${type}-${Date.now().toString(36)}`,
    type,
    title: "",
    body: "",
    badgeText: "",
    ctaLabel: "",
    ctaHref: "",
    secondaryCtaLabel: "",
    secondaryCtaHref: "",
    visible: true,
    sortOrder,
    styleVariant: "default",
    intentNotes: "",
  };
}

export function WebsiteBuilder({
  initialSections,
  counties,
}: {
  initialSections: BuilderSection[];
  counties: string[];
}) {
  const [sections, setSections] = useState<BuilderSection[]>(
    initialSections.slice().sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const [selectedId, setSelectedId] = useState<string>(
    initialSections[0]?.sectionId ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selected = sections.find((section) => section.sectionId === selectedId) ?? null;
  const copyWarnings = useMemo(
    () => (selected ? findForbiddenDefaultCopy(collectDraftCopy(selected)) : []),
    [selected],
  );

  function updateSelected(patch: Partial<BuilderSection>) {
    if (!selected) return;
    setSections((current) =>
      current.map((section) =>
        section.sectionId === selected.sectionId ? { ...section, ...patch } : section,
      ),
    );
  }

  function moveSelected(direction: -1 | 1) {
    if (!selected) return;
    const index = sections.findIndex((section) => section.sectionId === selected.sectionId);
    const next = index + direction;
    if (next < 0 || next >= sections.length) return;
    const copy = sections.slice();
    const [row] = copy.splice(index, 1);
    copy.splice(next, 0, row!);
    setSections(copy.map((section, sortOrder) => ({ ...section, sortOrder })));
  }

  function addSection(type: SiteSectionType) {
    const section = newSection(type, sections.length);
    setSections((current) => [...current, section]);
    setSelectedId(section.sectionId);
  }

  function removeSelected() {
    if (!selected || sections.length <= 1) return;
    const remaining = sections
      .filter((section) => section.sectionId !== selected.sectionId)
      .map((section, sortOrder) => ({ ...section, sortOrder }));
    setSections(remaining);
    setSelectedId(remaining[0]?.sectionId ?? "");
  }

  async function publish() {
    setPending(true);
    setError(null);
    setStatus(null);
    try {
      await adminFetch("/api/admin/site/pages/home", {
        method: "PUT",
        body: JSON.stringify({
          sections: sections.map((section, sortOrder) => ({
            ...section,
            sortOrder,
          })),
        }),
      });
      setStatus("Published to the storefront.");
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Publish failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-teal-950">Preview</p>
              <p className="text-xs text-teal-700">
                Click a section to edit it. Save publishes these sections to the public home page.
              </p>
            </div>
            <p className="text-[10px] uppercase tracking-wide text-teal-600">
              Click-to-edit · not a drag-drop designer
            </p>
          </div>
          <div className="space-y-4 rounded-2xl bg-teal-50/70 p-4">
            {sections.map((section) => {
              const active = section.sectionId === selectedId;
              return (
                <button
                  key={section.sectionId}
                  type="button"
                  onClick={() => setSelectedId(section.sectionId)}
                  className={cn(
                    "block w-full rounded-3xl border-2 p-2 text-left transition",
                    active
                      ? "border-teal-700 bg-white shadow-sm"
                      : "border-transparent hover:border-teal-200",
                    !section.visible && "opacity-50",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-2 px-2 text-[11px] uppercase tracking-wide text-teal-700">
                    <span>
                      {section.type}
                      {!section.visible ? " · hidden" : ""}
                    </span>
                    <span>{section.sectionId}</span>
                  </div>
                  <div className="pointer-events-none">
                    <SiteSectionView section={{ ...section, visible: true }} counties={counties} />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="space-y-4 xl:sticky xl:top-4">
        <div>
          <p className="text-sm font-semibold text-teal-950">Edit section</p>
          <p className="text-xs text-teal-700">
            Changes stay in this form until you publish.
          </p>
        </div>
        {selected ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void publish();
            }}
          >
            <Field label="Type">
              <Select
                value={selected.type}
                onChange={(event) =>
                  updateSelected({ type: event.target.value as SiteSectionType })
                }
              >
                {SITE_SECTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Section id" hint="Stable key used when publishing this block.">
              <Input value={selected.sectionId} readOnly />
            </Field>
            <Field label="Badge">
              <Input
                value={selected.badgeText}
                onChange={(event) => updateSelected({ badgeText: event.target.value })}
              />
            </Field>
            <Field label="Title">
              <Input
                value={selected.title}
                onChange={(event) => updateSelected({ title: event.target.value })}
              />
            </Field>
            <Field label="Body">
              <Textarea
                value={selected.body}
                onChange={(event) => updateSelected({ body: event.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Primary button label">
                <Input
                  value={selected.ctaLabel}
                  onChange={(event) => updateSelected({ ctaLabel: event.target.value })}
                />
              </Field>
              <Field label="Primary button link">
                <Input
                  value={selected.ctaHref}
                  onChange={(event) => updateSelected({ ctaHref: event.target.value })}
                  placeholder="/shop"
                />
              </Field>
              <Field label="Secondary button label">
                <Input
                  value={selected.secondaryCtaLabel}
                  onChange={(event) => updateSelected({ secondaryCtaLabel: event.target.value })}
                />
              </Field>
              <Field label="Secondary button link">
                <Input
                  value={selected.secondaryCtaHref}
                  onChange={(event) => updateSelected({ secondaryCtaHref: event.target.value })}
                  placeholder="/sign-in"
                />
              </Field>
            </div>
            <Field label="Style">
              <Select
                value={selected.styleVariant}
                onChange={(event) =>
                  updateSelected({
                    styleVariant: event.target.value as BuilderSection["styleVariant"],
                  })
                }
              >
                {SITE_STYLE_VARIANTS.map((variant) => (
                  <option key={variant} value={variant}>
                    {variant}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-teal-950">
              <input
                type="checkbox"
                checked={selected.visible}
                onChange={(event) => updateSelected({ visible: event.target.checked })}
              />
              Visible on the storefront
            </label>
            <Field
              label="Intent notes"
              hint="Admin-only: what this section should do. Not shown to shoppers."
            >
              <Textarea
                value={selected.intentNotes}
                onChange={(event) => updateSelected({ intentNotes: event.target.value })}
              />
            </Field>
            {copyWarnings.length > 0 ? (
              <p className="text-sm text-amber-800">
                This copy looks like same-day or name-brand marketing ({copyWarnings.join(", ")}).
                Defaults never use those phrases.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => moveSelected(-1)}>
                Move up
              </Button>
              <Button type="button" variant="outline" onClick={() => moveSelected(1)}>
                Move down
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => removeSelected()}
                disabled={sections.length <= 1}
              >
                Remove
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {SITE_SECTION_TYPES.map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => addSection(type)}
                >
                  Add {type}
                </Button>
              ))}
            </div>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            {status ? <p className="text-sm text-teal-800">{status}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Publishing…" : "Save and publish"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-teal-800">Select a section in the preview.</p>
        )}
      </Card>
    </div>
  );
}
