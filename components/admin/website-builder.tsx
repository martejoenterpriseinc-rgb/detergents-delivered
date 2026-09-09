"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_HOME_SECTIONS,
  SITE_SECTION_TYPES,
  SITE_STYLE_VARIANTS,
  siteImageUrl,
  type SiteDocument,
  type SiteSectionDraft,
  type SiteSettings,
} from "@/lib/domain/site-content";
const DEVICES = {
  computer: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};
export function WebsiteBuilder({
  initialDocument,
  initialVersion,
  hasDraft,
}: {
  initialDocument: SiteDocument;
  initialVersion: number;
  hasDraft: boolean;
}) {
  const [content, setContent] = useState(initialDocument),
    [version, setVersion] = useState(initialVersion);
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify(initialDocument));
  const [selection, setSelection] = useState(
    initialDocument.sections[0]?.sectionId ?? "header",
  );
  const [device, setDevice] = useState<keyof typeof DEVICES>("computer");
  const [editing, setEditing] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [error, setError] = useState(false),
    [draftSaved, setDraftSaved] = useState(hasDraft);
  const [availableWidth, setAvailableWidth] = useState(900);
  const [history, setHistory] = useState<Array<{
    version: number;
    createdAt: string;
  }> | null>(null);
  const [historyBefore, setHistoryBefore] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement>(null),
    frameHost = useRef<HTMLDivElement>(null);
  const attempt = useRef<{ fingerprint: string; requestKey: string } | null>(null);
  const dirty = JSON.stringify(content) !== savedSnapshot;
  const section = content.sections.find((s) => s.sectionId === selection);
  const sendPreview = useCallback(
    () =>
      frame.current?.contentWindow?.postMessage(
        { type: "dd-builder:state", document: content, selection, editing },
        window.location.origin,
      ),
    [content, selection, editing],
  );
  useEffect(() => {
    sendPreview();
  }, [sendPreview]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.type === "dd-builder:ready") sendPreview();
      if (
        event.data?.type === "dd-builder:select" &&
        typeof event.data.sectionId === "string" &&
        (["header", "footer", "announcement", "theme"].includes(event.data.sectionId) ||
          content.sections.some((s) => s.sectionId === event.data.sectionId))
      )
        setSelection(event.data.sectionId);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [content, sendPreview]);
  useEffect(() => {
    if (!frameHost.current) return;
    const observer = new ResizeObserver((entries) =>
      setAvailableWidth(entries[0].contentRect.width),
    );
    observer.observe(frameHost.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    const navigate = (event: MouseEvent) => {
      if (!dirty || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        !link ||
        link.target === "_blank" ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const url = new URL(link.href, window.location.href);
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.origin === window.location.origin
      )
        return;
      // Keep the work in place; the owner can save a draft, or explicitly reload to discard.
      event.preventDefault();
      event.stopImmediatePropagation();
      setError(true);
      setMessage(
        "You have unsaved changes. Save a draft or apply your changes before leaving. Use Reload saved version to discard them.",
      );
    };
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  function updateSection(patch: Partial<SiteSectionDraft>) {
    setContent((c) => ({
      ...c,
      sections: c.sections.map((s) =>
        s.sectionId === selection ? { ...s, ...patch } : s,
      ),
    }));
    setMessage("");
  }
  function updateSettings(patch: Partial<SiteSettings>) {
    setContent((c) => ({ ...c, settings: { ...c.settings, ...patch } }));
    setMessage("");
  }
  async function save(mode: "draft" | "publish") {
    setBusy(true);
    setMessage("");
    setError(false);
    const fingerprint = JSON.stringify({ document: content, version, mode });
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, requestKey: crypto.randomUUID() };
    try {
      const response = await fetch("/api/admin/site/pages/home", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: content,
          version,
          mode,
          requestKey: attempt.current.requestKey,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to save. Your edits are still here.");
      setVersion(result.version);
      setSavedSnapshot(JSON.stringify(content));
      setDraftSaved(mode === "draft");
      setHistory(null);
      attempt.current = null;
      setMessage(
        mode === "publish"
          ? "Saved and applied to the storefront."
          : "Draft saved. The storefront keeps its published version.",
      );
    } catch (e) {
      setError(true);
      setMessage(
        e instanceof Error
          ? e.message
          : "Save could not be confirmed. Retry with your edits intact.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/admin/site/pages/home", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to reload.");
      const document: SiteDocument = result.draft ?? {
        sections: result.page.sections,
        settings: result.page.settings,
      };
      setContent(document);
      setVersion(result.page.version);
      setSavedSnapshot(JSON.stringify(document));
      setDraftSaved(Boolean(result.draft));
      attempt.current = null;
      setMessage("Saved version loaded.");
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : "Unable to reload.");
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory(before?: number) {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/admin/site/pages/home?history=1${before === undefined ? "" : `&before=${before}`}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to load published versions.");
      setHistory((current) =>
        before === undefined
          ? result.revisions
          : [...(current ?? []), ...result.revisions],
      );
      setHistoryBefore(result.nextBefore);
    } catch (error) {
      setError(true);
      setMessage(
        error instanceof Error ? error.message : "Unable to load published versions.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function restoreRevision(revision: number) {
    if (dirty) {
      setError(true);
      setMessage(
        "Save a draft or reload the saved version before loading an earlier publication.",
      );
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`/api/admin/site/pages/home?revision=${revision}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load this version.");
      setContent(result.document);
      setSelection("header");
      attempt.current = null;
      setMessage(
        `Version ${revision} loaded for review. Save & apply to restore it to the storefront.`,
      );
    } catch (error) {
      setError(true);
      setMessage(error instanceof Error ? error.message : "Unable to load this version.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      setError(true);
      setMessage("Choose a photo under 4 MB.");
      return;
    }
    const target = selection;
    setBusy(true);
    setError(false);
    setMessage("Uploading photo…");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/admin/site/media", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Photo upload failed.");
      setContent((c) =>
        target === "header" || target === "footer"
          ? { ...c, settings: { ...c.settings, logoId: result.id } }
          : {
              ...c,
              sections: c.sections.map((s) =>
                s.sectionId === target ? { ...s, imageId: result.id } : s,
              ),
            },
      );
      setMessage("Photo uploaded. Add its description, then Save & apply.");
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : "Photo upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function move(delta: number) {
    setContent((c) => {
      const sections = [...c.sections],
        index = sections.findIndex((s) => s.sectionId === selection),
        target = index + delta;
      if (target < 0 || target >= sections.length) return c;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...c, sections: sections.map((s, i) => ({ ...s, sortOrder: i })) };
    });
    setMessage("");
  }
  function addSection() {
    const sectionId = `section-${crypto.randomUUID().slice(0, 8)}`;
    setContent((c) => ({
      ...c,
      sections: [
        ...c.sections,
        {
          ...DEFAULT_HOME_SECTIONS[0],
          sectionId,
          type: "features",
          title: "Your new section",
          body: "",
          badgeText: "",
          ctaLabel: "",
          ctaHref: "",
          secondaryCtaLabel: "",
          secondaryCtaHref: "",
          imageId: "",
          imageAlt: "",
          intentNotes: "",
          sortOrder: c.sections.length,
        },
      ],
    }));
    setSelection(sectionId);
    setMessage("");
  }
  const scale = Math.min(1, Math.max(0.1, availableWidth / DEVICES[device].width));
  const imageId =
    section?.imageId ??
    (selection === "header" || selection === "footer" ? content.settings.logoId : "");
  return (
    <div className="wb-root">
      <div className="wb-toolbar">
        <div>
          <strong>
            {dirty
              ? "Unsaved changes"
              : draftSaved
                ? "Draft saved · not published"
                : "Published version"}
          </strong>
          <span>Version {version}</span>
        </div>
        <div className="wb-actions">
          <button type="button" disabled={busy} onClick={() => void save("draft")}>
            Save draft
          </button>
          <button
            type="button"
            className="wb-primary"
            disabled={busy}
            onClick={() => void save("publish")}
          >
            {busy ? "Working…" : "Save & apply"}
          </button>
          <a href="/" target="_blank" rel="noreferrer">
            View storefront ↗
          </a>
        </div>
      </div>
      {message && (
        <p role={error ? "alert" : "status"} className={error ? "wb-error" : "wb-status"}>
          {message}
        </p>
      )}
      <div className="wb-layout">
        <aside className="wb-editor">
          <fieldset disabled={busy}>
            <label>
              Selected area
              <select value={selection} onChange={(e) => setSelection(e.target.value)}>
                <optgroup label="Site">
                  <option value="header">Header & navigation</option>
                  <option value="announcement">Announcement</option>
                  <option value="footer">Footer</option>
                  <option value="theme">Colors</option>
                </optgroup>
                <optgroup label="Home page">
                  {content.sections.map((s) => (
                    <option key={s.sectionId} value={s.sectionId}>
                      {s.title || s.sectionId}
                      {s.visible ? "" : " (hidden)"}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <p className="wb-hint">
              Select an area here or click it in the preview. Changes appear as you edit.
            </p>
            {section && (
              <>
                <label>
                  Section type
                  <select
                    value={section.type}
                    onChange={(e) =>
                      updateSection({ type: e.target.value as SiteSectionDraft["type"] })
                    }
                  >
                    {SITE_SECTION_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Heading
                  <input
                    value={section.title}
                    maxLength={200}
                    onChange={(e) => updateSection({ title: e.target.value })}
                  />
                </label>
                <label>
                  {section.type === "steps"
                    ? "Steps (one title | description per line)"
                    : "Description"}
                  <textarea
                    rows={5}
                    value={section.body}
                    maxLength={8000}
                    onChange={(e) => updateSection({ body: e.target.value })}
                  />
                </label>
                <label>
                  Eyebrow
                  <input
                    value={section.badgeText}
                    maxLength={120}
                    onChange={(e) => updateSection({ badgeText: e.target.value })}
                  />
                </label>
                <label>
                  Button label
                  <input
                    value={section.ctaLabel}
                    maxLength={80}
                    onChange={(e) => updateSection({ ctaLabel: e.target.value })}
                  />
                </label>
                <label>
                  Button destination
                  <input
                    value={section.ctaHref}
                    maxLength={300}
                    placeholder="/shop"
                    onChange={(e) => updateSection({ ctaHref: e.target.value })}
                  />
                </label>
                <label>
                  Second button label
                  <input
                    value={section.secondaryCtaLabel}
                    maxLength={80}
                    onChange={(e) => updateSection({ secondaryCtaLabel: e.target.value })}
                  />
                </label>
                <label>
                  Second button destination
                  <input
                    value={section.secondaryCtaHref}
                    maxLength={300}
                    onChange={(e) => updateSection({ secondaryCtaHref: e.target.value })}
                  />
                </label>
                <div className="wb-two">
                  <label>
                    Style
                    <select
                      value={section.styleVariant}
                      onChange={(e) =>
                        updateSection({
                          styleVariant: e.target
                            .value as SiteSectionDraft["styleVariant"],
                        })
                      }
                    >
                      {SITE_STYLE_VARIANTS.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Alignment
                    <select
                      value={section.alignment ?? "left"}
                      onChange={(e) =>
                        updateSection({ alignment: e.target.value as "left" | "center" })
                      }
                    >
                      <option>left</option>
                      <option>center</option>
                    </select>
                  </label>
                </div>
                <label>
                  Section spacing
                  <select
                    value={section.spacing ?? "normal"}
                    onChange={(e) =>
                      updateSection({
                        spacing: e.target.value as SiteSectionDraft["spacing"],
                      })
                    }
                  >
                    <option>compact</option>
                    <option>normal</option>
                    <option>roomy</option>
                  </select>
                </label>
                <label className="wb-checkbox">
                  <input
                    type="checkbox"
                    checked={section.visible}
                    onChange={(e) => updateSection({ visible: e.target.checked })}
                  />
                  Visible on storefront
                </label>
                {section.type === "products" && (
                  <p className="wb-hint">
                    Products, prices, stock and product photos come from{" "}
                    <a href="/admin/inventory">Inventory</a>.
                  </p>
                )}
                {section.type === "service-area" && (
                  <p className="wb-hint">
                    The map follows active delivery ZIP codes in{" "}
                    <a href="/admin/settings/launch">Settings → Launch & capacity</a>.
                    Location data never changes ordering eligibility.
                  </p>
                )}
              </>
            )}
            {selection === "header" && (
              <>
                <label>
                  Business name
                  <input
                    value={content.settings.brandName}
                    maxLength={80}
                    onChange={(e) => updateSettings({ brandName: e.target.value })}
                  />
                </label>
                <label>
                  Tagline
                  <input
                    value={content.settings.tagline}
                    maxLength={160}
                    onChange={(e) => updateSettings({ tagline: e.target.value })}
                  />
                </label>
                <NavigationFields
                  value={content.settings.navigation}
                  onChange={(navigation) => updateSettings({ navigation })}
                />
                <p className="wb-hint">
                  Account access, sign in, cart and the mobile menu stay connected to the
                  store.
                </p>
              </>
            )}
            {selection === "footer" && (
              <>
                <label>
                  Footer description
                  <textarea
                    rows={5}
                    value={content.settings.footerText}
                    maxLength={2000}
                    onChange={(e) => updateSettings({ footerText: e.target.value })}
                  />
                </label>
                <label>
                  Copyright text
                  <input
                    value={content.settings.copyrightText}
                    maxLength={200}
                    onChange={(e) => updateSettings({ copyrightText: e.target.value })}
                  />
                </label>
                <NavigationFields
                  value={content.settings.footerLinks}
                  onChange={(footerLinks) => updateSettings({ footerLinks })}
                />
                <p className="wb-hint">
                  Terms, Privacy and Refunds link to your store policies.
                </p>
              </>
            )}
            {selection === "announcement" && (
              <>
                <label>
                  Announcement text
                  <textarea
                    rows={3}
                    value={content.settings.announcement}
                    maxLength={300}
                    onChange={(e) => updateSettings({ announcement: e.target.value })}
                  />
                </label>
                <label>
                  Announcement link
                  <input
                    value={content.settings.announcementHref}
                    maxLength={300}
                    onChange={(e) => updateSettings({ announcementHref: e.target.value })}
                  />
                </label>
                <p className="wb-hint">
                  Leave the text empty to hide the announcement. Ordering availability
                  follows Launch settings.
                </p>
              </>
            )}
            {selection === "theme" && (
              <label>
                Color palette
                <select
                  value={content.settings.theme}
                  onChange={(e) =>
                    updateSettings({ theme: e.target.value as SiteSettings["theme"] })
                  }
                >
                  <option value="ocean">Ocean blue</option>
                  <option value="teal">Fresh teal</option>
                  <option value="navy">Classic navy</option>
                </select>
              </label>
            )}
            {(section || selection === "header" || selection === "footer") && (
              <div className="wb-photo">
                <strong>{section ? "Section photo" : "Business logo"}</strong>

                {imageId && (
                  <Image
                    unoptimized
                    src={siteImageUrl(imageId)}
                    alt="Current selected photo"
                    width={240}
                    height={160}
                  />
                )}
                <label>
                  Upload {section ? "photo" : "logo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void upload(file);
                    }}
                  />
                </label>
                <p className="wb-hint">
                  JPEG, PNG or WebP · up to 4 MB. Uploads are saved before they can be
                  applied.
                </p>
                {section && (
                  <>
                    <label>
                      Photo description
                      <input
                        value={section.imageAlt ?? ""}
                        maxLength={300}
                        onChange={(e) => updateSection({ imageAlt: e.target.value })}
                      />
                    </label>
                    <label>
                      Photo fit
                      <select
                        value={section.imageFit ?? "cover"}
                        onChange={(e) =>
                          updateSection({
                            imageFit: e.target.value as "cover" | "contain",
                          })
                        }
                      >
                        <option value="cover">Fill and crop</option>
                        <option value="contain">Show entire photo</option>
                      </select>
                    </label>
                    <div className="wb-two">
                      {(
                        [
                          ["imagePositionX", "Photo horizontal position"],
                          ["imagePositionY", "Photo vertical position"],
                          ["mobileImagePositionX", "Mobile photo horizontal position"],
                          ["mobileImagePositionY", "Mobile photo vertical position"],
                        ] as const
                      ).map(([field, label]) => (
                        <label key={field}>
                          {label} ({section[field] ?? 50}%)
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={section[field] ?? 50}
                            aria-label={label}
                            onChange={(event) =>
                              updateSection({ [field]: Number(event.target.value) })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {imageId && (
                  <button
                    type="button"
                    onClick={() =>
                      section
                        ? updateSection({ imageId: "", imageAlt: "" })
                        : updateSettings({ logoId: "" })
                    }
                  >
                    Remove photo from area
                  </button>
                )}
              </div>
            )}
            {section && (
              <>
                <label>
                  Editor notes (private)
                  <textarea
                    rows={2}
                    value={section.intentNotes}
                    maxLength={2000}
                    onChange={(e) => updateSection({ intentNotes: e.target.value })}
                  />
                </label>
                <div className="wb-actions">
                  <button
                    type="button"
                    disabled={content.sections[0]?.sectionId === selection}
                    onClick={() => move(-1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    disabled={content.sections.at(-1)?.sectionId === selection}
                    onClick={() => move(1)}
                  >
                    Move down
                  </button>
                </div>
                <button
                  type="button"
                  disabled={content.sections.length <= 1}
                  onClick={() => {
                    setContent((c) => ({
                      ...c,
                      sections: c.sections
                        .filter((s) => s.sectionId !== selection)
                        .map((s, sortOrder) => ({ ...s, sortOrder })),
                    }));
                    setSelection("header");
                    setMessage("");
                  }}
                >
                  Remove section
                </button>
              </>
            )}
            <button
              type="button"
              disabled={content.sections.length >= 40}
              onClick={addSection}
            >
              + Add section
            </button>
            <button type="button" onClick={() => void reload()}>
              Reload saved version{dirty ? " (discard edits)" : ""}
            </button>
            <button type="button" onClick={() => void loadHistory()}>
              Published versions
            </button>
            {history && (
              <div className="wb-history">
                <strong>Published versions</strong>
                <p className="wb-hint">
                  Load a version to review it, then Save & apply to restore it.
                </p>
                {history.length === 0 && <p>No earlier publications yet.</p>}
                {history.map((item) => (
                  <button
                    key={item.version}
                    type="button"
                    onClick={() => void restoreRevision(item.version)}
                  >
                    Load version {item.version} ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </button>
                ))}
                {historyBefore !== null && (
                  <button type="button" onClick={() => void loadHistory(historyBefore)}>
                    Older versions
                  </button>
                )}
              </div>
            )}
          </fieldset>
        </aside>
        <div className="wb-preview-panel">
          <div className="wb-preview-tools">
            <div role="group" aria-label="Preview device">
              {(Object.keys(DEVICES) as Array<keyof typeof DEVICES>).map((d) => (
                <button
                  type="button"
                  key={d}
                  aria-pressed={device === d}
                  onClick={() => setDevice(d)}
                >
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            <label className="wb-checkbox">
              <input
                type="checkbox"
                checked={editing}
                onChange={(e) => setEditing(e.target.checked)}
              />
              Click to edit
            </label>
          </div>
          <p className="wb-hint">
            {DEVICES[device].width} × {DEVICES[device].height} · {Math.round(scale * 100)}
            % scale · Visitor preview
          </p>
          <div
            ref={frameHost}
            className="wb-frame-host"
            style={{ height: DEVICES[device].height * scale }}
          >
            <iframe
              ref={frame}
              title={`${device} storefront preview`}
              src="/website-preview"
              onLoad={sendPreview}
              style={{
                width: DEVICES[device].width,
                height: DEVICES[device].height,
                transform: `scale(${scale})`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
function NavigationFields({
  value,
  onChange,
}: {
  value: SiteSettings["navigation"];
  onChange: (value: SiteSettings["navigation"]) => void;
}) {
  return (
    <div className="wb-links">
      <strong>Links</strong>
      {value.map((link, index) => (
        <div key={index}>
          <label>
            Link {index + 1} label
            <input
              value={link.label}
              maxLength={60}
              onChange={(e) =>
                onChange(
                  value.map((n, i) =>
                    i === index ? { ...n, label: e.target.value } : n,
                  ),
                )
              }
            />
          </label>
          <label>
            Link {index + 1} destination
            <input
              value={link.href}
              maxLength={300}
              onChange={(e) =>
                onChange(
                  value.map((n, i) => (i === index ? { ...n, href: e.target.value } : n)),
                )
              }
            />
          </label>
          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Remove link {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={value.length >= 6}
        onClick={() => onChange([...value, { label: "New link", href: "/shop" }])}
      >
        + Link
      </button>
    </div>
  );
}
