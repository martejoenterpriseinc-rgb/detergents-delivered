"use client";
import { useEffect, useState } from "react";
import { StorefrontChrome } from "@/components/storefront/chrome";
import { StorefrontHome, type HomeProduct } from "@/components/storefront/home";
import { validateSiteDocument, type SiteDocument } from "@/lib/domain/site-content";
import type { DeliveryCoverage } from "@/lib/domain/delivery-coverage";
export function WebsitePreview({
  initialDocument,
  products,
  coverage,
  launchNotice,
}: {
  initialDocument: SiteDocument;
  products: HomeProduct[];
  coverage: DeliveryCoverage;
  launchNotice: string;
}) {
  const [content, setContent] = useState(initialDocument);
  const [selection, setSelection] = useState("hero");
  const [editing, setEditing] = useState(true);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        event.data?.type !== "dd-builder:state"
      )
        return;
      try {
        setContent(validateSiteDocument(event.data.document));
        setSelection(String(event.data.selection));
        setEditing(event.data.editing === true);
      } catch {
        /* Keep the last valid preview while a field is incomplete. */
      }
    }
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "dd-builder:ready" }, window.location.origin);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-site-area]").forEach((node) => {
      node.classList.toggle(
        "sf-edit-selected",
        editing && node.dataset.siteArea === selection,
      );
      if (editing) {
        node.tabIndex = 0;
        node.setAttribute("aria-label", `Edit ${node.dataset.siteArea}`);
      } else {
        node.removeAttribute("tabindex");
        node.removeAttribute("aria-label");
      }
    });
  }, [selection, editing, content]);
  function select(target: EventTarget | null) {
    if (!(target instanceof Element)) return;
    const area = target.closest<HTMLElement>("[data-site-area]")?.dataset.siteArea;
    if (area)
      window.parent.postMessage(
        { type: "dd-builder:select", sectionId: area },
        window.location.origin,
      );
  }
  return (
    <div
      className={editing ? "sf-edit-mode" : ""}
      onClickCapture={(event) => {
        const target = event.target;
        const navigates = target instanceof Element && target.closest("a");
        if (editing || navigates) {
          event.preventDefault();
          event.stopPropagation();
          if (editing) select(event.target);
        }
      }}
      onAuxClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onSubmitCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDownCapture={(event) => {
        if (editing && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopPropagation();
          select(event.target);
        }
      }}
    >
      <StorefrontChrome
        settings={content.settings}
        signedIn={false}
        launchNotice={launchNotice}
      >
        <StorefrontHome document={content} products={products} coverage={coverage} />
      </StorefrontChrome>
    </div>
  );
}
