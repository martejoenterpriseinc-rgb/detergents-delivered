"use client";
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Source } from "@/lib/business/definitions";
export const SaveNavigation = createContext<
  (flush: () => Promise<boolean>) => () => void
>(() => () => {});
export const fieldClass =
  "mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-2 focus:outline-teal-600";
export const panelClass =
  "rounded-2xl border border-teal-100 bg-white p-5 shadow-sm sm:p-6";
export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}
export function SourceLinks({ links }: { links: Source[] }) {
  const [now] = useState(() => Date.now());
  return (
    <ul className="space-y-2">
      {links.map((s) => (
        <li key={s.url} className="text-sm">
          <a
            className="font-medium text-teal-800 underline"
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            {s.title} ↗
          </a>
          <span className="ml-2 text-xs text-slate-500">Checked {s.checkedAt}</span>
          {(s.status === "REVIEW" || now - Date.parse(s.checkedAt) > 90 * 86400000) && (
            <p className="mt-1 text-amber-900">
              Review needed:{" "}
              {s.fallback ??
                "Recheck the official instructions before filing; this source review is over 90 days old."}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
// Serialized autosave. Inputs remain disabled only during the request; failed edits stay visible.
export function useSavedForm<T>(initial: T, save: (value: T) => Promise<void>) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [feedback, setFeedback] = useState("Saved");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = useRef(JSON.stringify(initial));
  const current = useRef(value);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  const [lastSaved, setLastSaved] = useState(JSON.stringify(initial));
  const dirty = JSON.stringify(value) !== lastSaved;
  const saving = useRef<Promise<boolean> | null>(null);
  const flush = useCallback(function flush(): Promise<boolean> {
    // Navigation and workflow actions must join an in-flight autosave instead
    // of silently losing the click. A failed save still blocks the action.
    if (saving.current) return saving.current.then((ok) => (ok ? flush() : false));
    if (JSON.stringify(current.current) === saved.current) return Promise.resolve(true);
    setBusy(true);
    setError("");
    setFeedback("Saving…");
    const submitted = current.current;
    const pending = Promise.resolve()
      .then(async () => {
        try {
          await saveRef.current(submitted);
          saved.current = JSON.stringify(submitted);
          setLastSaved(saved.current);
          setFeedback("Saved");
          return true;
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Save failed. Your edits are still here.",
          );
          setFeedback("Not saved");
          return false;
        }
      })
      .finally(() => {
        saving.current = null;
        setBusy(false);
      });
    saving.current = pending;
    return pending;
  }, []);
  const registerFlush = useContext(SaveNavigation);
  useEffect(() => registerFlush(flush), [registerFlush, flush]);
  useEffect(() => {
    if (!dirty || error) return;
    const timer = setTimeout(() => void flush(), 900);
    return () => clearTimeout(timer);
  }, [value, dirty, error, flush]);
  useEffect(() => {
    // The app sidebar lives outside this form. Save before its client navigation
    // can unmount the wizard; a failed save leaves the current edits visible.
    const navigate = (e: MouseEvent) => {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (JSON.stringify(current.current) === saved.current) return;
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.download ||
        (link.target && link.target !== "_self")
      )
        return;
      const url = new URL(link.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        (url.pathname === window.location.pathname &&
          url.search === window.location.search)
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void flush().then((ok) => {
        if (ok) router.push(`${url.pathname}${url.search}${url.hash}` as Route);
      });
    };
    document.addEventListener("click", navigate, true);
    return () => document.removeEventListener("click", navigate, true);
  }, [flush, router]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(current.current) !== saved.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  function edit(next: T) {
    current.current = next;
    setValue(next);
    setError("");
    setFeedback("Unsaved changes");
  }
  return { value, edit, feedback, busy, error, flush, dirty };
}
export function SaveFeedback({ feedback, error }: { feedback: string; error: string }) {
  return (
    <div>
      <p role="status" className="text-sm text-teal-800">
        {feedback}
      </p>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
