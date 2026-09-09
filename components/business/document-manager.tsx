"use client";
import { useState } from "react";
import Link from "next/link";
import { adminFetch } from "@/lib/admin-fetch";
import { activePlan, categories } from "@/lib/business/domain";
import type { BusinessWorkspace } from "@/lib/business/service";
import type { listBusinessDocuments, uploadSchema } from "@/lib/business/documents";
import type { z } from "zod";
import { fieldClass, panelClass } from "./shared";
type DocumentWorkspace = Awaited<ReturnType<typeof listBusinessDocuments>>;
export function DocumentManager({
  initial,
  setup,
}: {
  initial: DocumentWorkspace;
  setup: BusinessWorkspace;
}) {
  const [workspace, setWorkspace] = useState(initial);
  const [state, setState] = useState(setup);
  const [meta, setMeta] = useState<z.infer<typeof uploadSchema>>({
    requestKey: "",
    setupVersion: setup.version,
    title: "",
    category: "Other",
    planId: setup.data.activePlanId,
    stepKey: null,
    issueDate: "",
    expiryDate: "",
    notes: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [deleting, setDeleting] = useState("");
  const plan = activePlan(state.data);
  async function refresh() {
    const [docs, next] = await Promise.all([
      adminFetch<DocumentWorkspace>("/api/admin/business/documents"),
      adminFetch<BusinessWorkspace>("/api/admin/business"),
    ]);
    setWorkspace(docs);
    setState(next);
    return next;
  }
  async function upload() {
    if (!file) {
      setError("Choose a PDF, JPG or PNG first.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Saving encrypted document…");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("metadata", JSON.stringify(meta));
      const r = await fetch("/api/admin/business/documents", {
        method: "PUT",
        body: form,
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Upload could not be confirmed.");
      const next = await refresh();
      setMeta({
        requestKey: "",
        setupVersion: next.version,
        title: "",
        category: "Other",
        planId: next.data.activePlanId,
        stepKey: null,
        issueDate: "",
        expiryDate: "",
        notes: "",
      });
      setFile(null);
      setMessage(
        body.scanStatus === "CLEAN"
          ? "Saved and cleared by security scanning."
          : "Saved encrypted. Quarantined until security scanning completes.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setMessage("Not confirmed — your file and details are retained for retry.");
    } finally {
      setBusy(false);
    }
  }
  async function action(command: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await adminFetch<{ url?: string }>("/api/admin/business/documents", {
        method: "POST",
        body: JSON.stringify(command),
      });
      if (result.url) setPreview(result.url);
      else {
        await refresh();
        setMessage("Saved.");
      }
      setDeleting("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the action.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-700">
            Business Settings / DetergentsDelivered
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Business Documents</h1>
          <p className="mt-2 text-sm text-slate-600">
            Private records with version history, encryption and permission checks.
          </p>
        </div>
        <Link className="ops-button secondary" href="/admin/settings/business/setup">
          Continue Business Setup
        </Link>
      </div>
      {!workspace.readiness.encryption && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm">
          Private document encryption must be configured before uploads are available.
        </p>
      )}
      {!workspace.readiness.scannerConfigured && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm">
          Security scanning is not connected. Uploads remain encrypted and quarantined;
          they cannot be previewed, downloaded or used as completion evidence until
          cleared.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-900">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-teal-800">
        {message}
      </p>
      <section className={panelClass}>
        <h2 className="text-xl font-semibold">
          {meta.documentId
            ? "Replace document — retain version history"
            : "Add a business document"}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          PDF, JPG or PNG, up to 5 MB. Do not upload passwords, SSNs, full bank statements
          or unmasked account numbers.
        </p>
        <fieldset disabled={busy} className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Document title
            <input
              className={fieldClass}
              maxLength={160}
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
          </label>
          <label className="text-sm font-medium">
            Category
            <select
              className={fieldClass}
              value={meta.category}
              onChange={(e) =>
                setMeta({ ...meta, category: e.target.value as typeof meta.category })
              }
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Related step
            <select
              className={fieldClass}
              disabled={Boolean(meta.documentId)}
              value={meta.stepKey ?? ""}
              onChange={(e) => setMeta({ ...meta, stepKey: e.target.value || null })}
            >
              <option value="">General business record</option>
              {state.definitions.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
          {(["issueDate", "expiryDate"] as const).map((k) => (
            <label key={k} className="text-sm font-medium">
              {k === "issueDate" ? "Issue date" : "Expiration date"}
              <input
                className={fieldClass}
                type="date"
                value={meta[k]}
                onChange={(e) => setMeta({ ...meta, [k]: e.target.value })}
              />
            </label>
          ))}
          <label className="text-sm font-medium sm:col-span-2">
            Notes
            <textarea
              className={fieldClass}
              rows={2}
              maxLength={2000}
              value={meta.notes}
              onChange={(e) => setMeta({ ...meta, notes: e.target.value })}
            />
          </label>
          <label className="text-sm font-medium">
            Choose a document
            <input
              key={meta.documentId ?? message}
              className={fieldClass}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setMeta({
                  ...meta,
                  requestKey: crypto.randomUUID(),
                  setupVersion: state.version,
                });
              }}
            />
          </label>
          <label className="text-sm font-medium">
            Or take a photo
            <input
              className={fieldClass}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setMeta({
                  ...meta,
                  requestKey: crypto.randomUUID(),
                  setupVersion: state.version,
                });
              }}
            />
          </label>
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="ops-button"
            disabled={busy || !workspace.readiness.encryption}
            onClick={() => void upload()}
          >
            {busy ? "Working…" : "Save document"}
          </button>
          <p className="text-sm">{file?.name ?? "No file selected"}</p>
        </div>
      </section>
      <section className={panelClass}>
        <h2 className="text-xl font-semibold">Saved documents</h2>
        {workspace.documents.length === 0 && (
          <p className="mt-4 text-sm text-slate-600">
            No documents yet. Documents from every saved structure remain available here.
          </p>
        )}
        <div className="mt-4 space-y-4">
          {workspace.documents.map((doc) => (
            <article key={doc.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{doc.title}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {doc.category} • Uploaded{" "}
                    {new Date(doc.createdAt).toLocaleDateString()} • Version {doc.version}
                    {doc.planId !== plan?.id ? " • Retained earlier/general record" : ""}
                  </p>
                  <p className="mt-1 text-xs">
                    Issue: {doc.issueDate ?? "Not recorded"} • Expires:{" "}
                    {doc.expiryDate ?? "Not recorded"}
                  </p>
                  <p className="mt-2 text-sm whitespace-pre-wrap">{doc.notes}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="ops-button secondary"
                    disabled={busy}
                    onClick={() => {
                      setMeta({
                        requestKey: "",
                        setupVersion: state.version,
                        documentId: doc.id,
                        version: doc.version,
                        title: doc.title,
                        category: doc.category as typeof meta.category,
                        planId: doc.planId,
                        stepKey: doc.stepKey,
                        issueDate: doc.issueDate ?? "",
                        expiryDate: doc.expiryDate ?? "",
                        notes: doc.notes,
                      });
                      setFile(null);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Replace
                  </button>
                  {workspace.owner && (
                    <button
                      className="text-sm font-semibold text-red-800 underline"
                      disabled={busy}
                      onClick={() => setDeleting(doc.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {deleting === doc.id && (
                <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm">
                  <p>
                    Delete every version of this document? Linked completed steps require
                    renewed review. Encrypted backups expire under the host’s retention
                    policy.
                  </p>
                  <button
                    className="ops-button mt-3"
                    disabled={busy}
                    onClick={() =>
                      void action({
                        action: "delete",
                        documentId: doc.id,
                        version: doc.version,
                        acknowledge: true,
                      })
                    }
                  >
                    Confirm deletion
                  </button>
                  <button className="ml-3 underline" onClick={() => setDeleting("")}>
                    Cancel
                  </button>
                </div>
              )}
              <details className="mt-4" open={doc.versions.length === 1}>
                <summary className="cursor-pointer text-sm font-semibold">
                  Version history
                </summary>
                <ul className="mt-2 space-y-2">
                  {doc.versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-3 text-sm">
                      <span>
                        v{v.number} • {new Date(v.createdAt).toLocaleString()} •{" "}
                        {v.scanStatus} • {Math.ceil(v.size / 1024)} KB
                      </span>
                      {v.scanStatus === "CLEAN" && !v.deletedAt && (
                        <button
                          className="font-semibold text-teal-800 underline"
                          disabled={busy}
                          onClick={() =>
                            void action({ action: "access", versionId: v.id })
                          }
                        >
                          Preview / download
                        </button>
                      )}
                      {v.scanStatus === "QUARANTINED" && !v.deletedAt && (
                        <button
                          className="font-semibold text-teal-800 underline"
                          disabled={busy}
                          onClick={() => void action({ action: "scan", versionId: v.id })}
                        >
                          Retry security scan
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
        </div>
      </section>
      {preview && (
        <section className={panelClass}>
          <h2 className="text-xl font-semibold">Private preview</h2>
          <p className="my-3 text-sm">
            Access expires after 90 seconds and still requires your authorized signed-in
            session.
          </p>
          <div className="mb-4 flex gap-4">
            <a
              className="font-semibold text-teal-800 underline"
              href={`${preview}&download=1`}
              referrerPolicy="no-referrer"
            >
              Download document
            </a>
            <a
              className="font-semibold text-teal-800 underline"
              href={preview}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open document
            </a>
            <button className="underline" onClick={() => setPreview("")}>
              Close preview
            </button>
          </div>
          <iframe
            title="Private business document preview"
            src={preview}
            className="h-[600px] w-full rounded-lg border"
            referrerPolicy="no-referrer"
          />
        </section>
      )}
    </div>
  );
}
