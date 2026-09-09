"use client";
import { useRouter } from "next/navigation";
import type { BusinessPlan, TaskRecord } from "@/lib/business/domain";
import { emptyTask, statuses, statusNames } from "@/lib/business/domain";
import { taskDeadlines, type StepDefinition } from "@/lib/business/definitions";
import {
  fieldClass,
  money,
  panelClass,
  SaveFeedback,
  SourceLinks,
  useSavedForm,
} from "./shared";
import Link from "next/link";
export function StepForm({
  plan,
  definition,
  documents,
  onSave,
  onBack,
  onContinue,
}: {
  plan: BusinessPlan;
  definition: StepDefinition;
  documents: {
    id: string;
    title: string;
    planId: string | null;
    versions: { scanStatus: string; deletedAt: Date | string | null }[];
  }[];
  onSave: (t: TaskRecord) => Promise<void>;
  onBack: () => void;
  onContinue: () => void;
}) {
  const router = useRouter();
  const f = useSavedForm(
    plan.tasks[definition.key] ?? structuredClone(emptyTask),
    onSave,
  );
  const t = f.value;
  const d = definition;
  function set<K extends keyof TaskRecord>(key: K, value: TaskRecord[K]) {
    f.edit({ ...t, [key]: value });
  }
  const deadlines = taskDeadlines(plan, d, t);
  return (
    <section className={panelClass} aria-labelledby="active-business-step">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
            {d.method}
          </span>
          <h2 id="active-business-step" className="mt-2 text-2xl font-semibold">
            {d.title}
          </h2>
        </div>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-sm">
          {statusNames[plan.tasks[d.key]?.status ?? "NOT_STARTED"]}
        </span>
      </div>
      <p className="mt-3 text-slate-600">{d.why}</p>
      {d.notice && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          {d.notice}
        </p>
      )}
      <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
        {d.instructions.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <SourceLinks links={d.links} />
      </div>
      <div className="my-5 grid gap-3 text-sm sm:grid-cols-2">
        <p>
          Known {d.recurring ? "recurring " : ""}fee:{" "}
          <strong>{d.feeCents === null ? "Quote required" : money(d.feeCents)}</strong>
        </p>
        <p>{d.variableCost ?? "Any professional or provider charges are separate."}</p>
        {deadlines.map((x) => (
          <p key={x.label}>
            {x.label}: <strong>{x.date}</strong>
          </p>
        ))}
      </div>
      <p className="text-sm text-slate-600">
        Government status is maintained manually. Completed means owner or
        authorized-admin confirmed; it is not independent government verification.
      </p>
      <fieldset disabled={f.busy} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Step status
          <select
            className={fieldClass}
            value={t.status}
            onChange={(e) => set("status", e.target.value as TaskRecord["status"])}
          >
            {statuses.map((s) => (
              <option key={s} value={s} disabled={s === "NOT_APPLICABLE" && !d.allowNA}>
                {statusNames[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Reference / state file number / Illinois account ID
          <input
            className={fieldClass}
            value={t.reference}
            onChange={(e) => set("reference", e.target.value)}
            maxLength={200}
            autoComplete="off"
          />
        </label>
        {(
          [
            ["filedDate", "Filing / delivered date"],
            [
              "approvedDate",
              d.key === "formation"
                ? "Actual formation / approval date"
                : "Approval / acceptance date",
            ],
            [
              "deadline",
              d.recurring ? "Next recurring deadline" : "Other confirmed deadline",
            ],
          ] as const
        ).map(([k, label]) => (
          <label className="text-sm font-medium" key={k}>
            {label}
            <input
              className={fieldClass}
              type="date"
              value={t[k]}
              onChange={(e) => set(k, e.target.value)}
            />
          </label>
        ))}
        <label className="text-sm font-medium">
          Provider website (HTTPS)
          <input
            className={fieldClass}
            type="url"
            value={t.providerUrl}
            onChange={(e) => set("providerUrl", e.target.value)}
            maxLength={1000}
          />
        </label>
        {(
          [
            ["actualPaidCents", "Actual filing / provider amount paid ($)"],
            ["variablePaidCents", "Actual publication / other variable cost paid ($)"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="text-sm font-medium">
            {label}
            <input
              className={fieldClass}
              inputMode="decimal"
              type="number"
              min="0"
              step="0.01"
              placeholder="Not entered"
              value={t[k] === null ? "" : t[k] / 100}
              onChange={(e) =>
                set(
                  k,
                  e.target.value === "" ? null : Math.round(Number(e.target.value) * 100),
                )
              }
            />
          </label>
        ))}
        {d.key === "dba" && !d.unknown && (
          <div className="space-y-3 sm:col-span-2">
            <div className="grid gap-3 sm:grid-cols-3">
              {t.publicationDates.map((date, i) => (
                <label key={i} className="text-sm font-medium">
                  Publication {i + 1}
                  <input
                    className={fieldClass}
                    type="date"
                    value={date}
                    onChange={(e) =>
                      set(
                        "publicationDates",
                        t.publicationDates.map((x, j) => (j === i ? e.target.value : x)),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={t.proofReceived}
                onChange={(e) => set("proofReceived", e.target.checked)}
              />
              I confirmed the original publication proof reached the county clerk.
            </label>
            <label className="block text-sm font-medium">
              Clerk received proof on
              <input
                className={fieldClass}
                type="date"
                value={t.proofReceivedDate}
                onChange={(e) => set("proofReceivedDate", e.target.value)}
              />
            </label>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={t.existing}
            onChange={(e) => set("existing", e.target.checked)}
          />
          This is an existing filing/account for this same legal owner. I am recording its
          evidence, not applying again.
        </label>
        {d.unknown && (
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={t.applicabilityConfirmed}
              onChange={(e) => set("applicabilityConfirmed", e.target.checked)}
            />
            I confirmed applicability with the agency or qualified reviewer and recorded
            their response below.
          </label>
        )}
        <label className="text-sm font-medium sm:col-span-2">
          Notes / authority response
          <textarea
            className={fieldClass}
            rows={3}
            value={t.notes}
            onChange={(e) => set("notes", e.target.value)}
            maxLength={2000}
          />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Next action
          <textarea
            className={fieldClass}
            rows={2}
            value={t.nextAction}
            onChange={(e) => set("nextAction", e.target.value)}
            maxLength={2000}
          />
        </label>
        {t.status === "NOT_APPLICABLE" && (
          <label className="text-sm font-medium sm:col-span-2">
            Not Applicable reason and supporting authority
            <textarea
              className={fieldClass}
              rows={3}
              value={t.naReason}
              onChange={(e) => set("naReason", e.target.value)}
              maxLength={2000}
            />
          </label>
        )}
        <div className="space-y-3 rounded-xl border border-teal-100 p-4 sm:col-span-2">
          <p className="text-sm font-semibold">Completion evidence</p>
          <p className="text-sm text-slate-600">{d.evidence}</p>
          {documents
            .filter(
              (doc) => doc.planId === plan.id && doc.versions[0]?.scanStatus === "CLEAN",
            )
            .map((doc) => (
              <label key={doc.id} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={t.documentIds.includes(doc.id)}
                  onChange={(e) =>
                    set(
                      "documentIds",
                      e.target.checked
                        ? [...t.documentIds, doc.id]
                        : t.documentIds.filter((id) => id !== doc.id),
                    )
                  }
                />
                {doc.title}
              </label>
            ))}
          <label className="block text-sm font-medium">
            Explicit completion attestation
            <textarea
              className={fieldClass}
              rows={3}
              placeholder="What you confirmed, with whom, and on which date (at least 20 characters)."
              value={t.attestation}
              onChange={(e) => set("attestation", e.target.value)}
              maxLength={2000}
            />
          </label>
          <Link
            className="text-sm font-semibold text-teal-800 underline"
            href="/admin/settings/business/documents"
            onClick={async (e) => {
              e.preventDefault();
              if (await f.flush()) router.push("/admin/settings/business/documents");
            }}
          >
            Open private Business Documents
          </Link>
        </div>
      </fieldset>
      <p className="mt-4 text-xs text-slate-500">
        Last saved update:{" "}
        {plan.tasks[d.key]?.updatedAt
          ? new Date(plan.tasks[d.key].updatedAt).toLocaleString()
          : "Not updated yet"}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SaveFeedback feedback={f.feedback} error={f.error} />
        <button
          className="ops-button secondary"
          disabled={f.busy}
          onClick={async () => {
            if (await f.flush()) onBack();
          }}
        >
          Back
        </button>
        <button
          className="ops-button"
          disabled={f.busy}
          onClick={async () => {
            if (await f.flush()) onContinue();
          }}
        >
          Save and Continue
        </button>
        <button
          className="ops-button secondary"
          disabled={f.busy}
          onClick={async () => {
            if (await f.flush()) router.push("/admin");
          }}
        >
          Save and Exit
        </button>
        {f.error && (
          <button className="ops-button secondary" onClick={() => void f.flush()}>
            Retry save
          </button>
        )}
      </div>
    </section>
  );
}
