"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { z } from "zod";
import { adminFetch } from "@/lib/admin-fetch";
import {
  actionSchema,
  activePlan,
  emptyProfile,
  statusNames,
  structureNames,
  type BusinessProfile,
  type Structure,
} from "@/lib/business/domain";
import {
  comparison,
  definitions,
  sources,
  RESEARCH_DATE,
} from "@/lib/business/definitions";
import type { BusinessWorkspace } from "@/lib/business/service";
import type { listBusinessDocuments } from "@/lib/business/documents";
import { panelClass, fieldClass, money, SourceLinks, SaveNavigation } from "./shared";
import { ProfileForm } from "./profile-form";
import { StepForm } from "./step-form";
type DocumentWorkspace = Awaited<ReturnType<typeof listBusinessDocuments>>;
export function SetupWizard({
  initial,
  documents,
}: {
  initial: BusinessWorkspace;
  documents: DocumentWorkspace;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [preview, setPreview] = useState<Structure>("SOLE");
  const [screen, setScreen] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [transitionReason, setTransitionReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState(
    initial.data.transition?.draftReviewNotes ?? "",
  );
  const [transitionProfile, setTransitionProfile] = useState<BusinessProfile>(
    initial.data.transition?.draftProfile ?? emptyProfile,
  );
  const [supplier, setSupplier] = useState("");
  const [accessEmail, setAccessEmail] = useState("");
  const versionRef = useRef(state.version);
  const flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const registerFlush = useCallback((fn: () => Promise<boolean>) => {
    flushRef.current = fn;
    return () => {
      flushRef.current = () => Promise.resolve(true);
    };
  }, []);
  async function navigate(next: string) {
    if (await flushRef.current()) setScreen(next);
  }
  const plan = activePlan(state.data);
  const stats = state.progress;
  const selected =
    state.definitions.find((d) => d.key === screen) ?? state.definitions[0];
  async function command(c: z.infer<typeof actionSchema>) {
    const next = await adminFetch<BusinessWorkspace>("/api/admin/business", {
      method: "POST",
      body: JSON.stringify({ version: versionRef.current, command: c }),
    });
    versionRef.current = next.version;
    setState(next);
    return next;
  }
  async function act(c: z.infer<typeof actionSchema>, after?: () => void) {
    if (!(await flushRef.current())) return;
    setBusy(true);
    setError("");
    try {
      const next = await command(c);
      if (next.data.transition) setTransitionProfile(next.data.transition.draftProfile);
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <SaveNavigation.Provider value={registerFlush}>
      <div className="mx-auto max-w-6xl min-w-0 space-y-6 pb-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-teal-700">
              Business Settings / DetergentsDelivered
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-teal-950">
              Business Setup
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Your filing checklist, records and next steps — saved as you work.
            </p>
          </div>
          <Link
            className="ops-button secondary"
            href="/admin/settings/business/documents"
            onClick={async (e) => {
              e.preventDefault();
              if (await flushRef.current())
                router.push("/admin/settings/business/documents");
            }}
          >
            Business Documents
          </Link>
        </div>
        <p className="text-sm text-slate-600">
          General guidance. Unusual ownership, transfers or tax situations may need
          professional review. You complete filings, payments, signatures and identity
          checks directly with the relevant agency or provider.
        </p>
        {error && (
          <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">
            {error}
            <button className="ml-3 underline" onClick={() => window.location.reload()}>
              Reload saved version
            </button>
          </div>
        )}
        {!plan ? (
          <>
            <section className={panelClass}>
              <h2 className="text-2xl font-semibold">
                Choose the structure that fits your business
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Preview either process below. A preview does not select or save a business
                type.
              </p>
              <div className="mt-5 max-w-full overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <caption className="sr-only">
                    Sole proprietor and single-member LLC comparison
                  </caption>
                  <thead>
                    <tr className="border-b border-teal-200">
                      <th className="p-3">Topic</th>
                      <th className="p-3 text-teal-800">Sole proprietor</th>
                      <th className="p-3 text-teal-800">Single-member LLC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((row) => (
                      <tr key={row[0]} className="border-b border-slate-100">
                        {row.map((v, i) =>
                          i === 0 ? (
                            <th key={i} scope="row" className="p-3 font-medium">
                              {v}
                            </th>
                          ) : (
                            <td key={i} className="p-3 align-top">
                              {v}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="my-4 text-sm">
                An LLC does not automatically reduce taxes. S corporation taxation is a
                separate decision to review with a CPA.
              </p>
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-teal-800">
                  Comparison sources • reviewed {RESEARCH_DATE}
                </summary>
                <div className="mt-3">
                  <SourceLinks links={[sources.sba, sources.irsLLC, sources.fees]} />
                </div>
              </details>
            </section>
            <ProfileForm
              initial={state.data.profile}
              onSave={async (p) => {
                await command({ action: "profile", profile: p });
              }}
              onContinue={() => setProfileReady(true)}
            />
            <section className={panelClass}>
              <div
                role="tablist"
                aria-label="Business structure previews"
                className="flex gap-2"
              >
                {(["SOLE", "LLC"] as const).map((s) => (
                  <button
                    key={s}
                    role="tab"
                    aria-selected={preview === s}
                    aria-controls={`preview-${s}`}
                    id={`tab-${s}`}
                    className={`rounded-xl px-4 py-3 text-sm font-semibold ${preview === s ? "bg-teal-900 text-white" : "bg-teal-50 text-teal-900"}`}
                    onClick={() => setPreview(s)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                        e.preventDefault();
                        const next = s === "SOLE" ? "LLC" : "SOLE";
                        setPreview(next);
                        document.getElementById(`tab-${next}`)?.focus();
                      }
                    }}
                  >
                    {structureNames[s]}
                  </button>
                ))}
              </div>
              <div
                role="tabpanel"
                id={`preview-${preview}`}
                aria-labelledby={`tab-${preview}`}
                className="mt-5"
              >
                <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
                  Preview only • No saved selection
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  {structureNames[preview]} setup process
                </h2>
                <ol className="mt-4 grid list-decimal gap-2 pl-5 text-sm sm:grid-cols-2">
                  {definitions(state.data.profile, preview).map((d) => (
                    <li key={d.key}>{d.title}</li>
                  ))}
                </ol>
                <button
                  className="ops-button mt-6"
                  disabled={busy || !state.owner}
                  onClick={() =>
                    void act(
                      { action: "choose", structure: preview, acknowledge: true },
                      () => setScreen(""),
                    )
                  }
                >
                  {preview === "SOLE" ? "Choose Sole Proprietor" : "Choose LLC"}
                </button>
                {!profileReady && (
                  <p className="mt-2 text-sm text-slate-600">
                    Complete and save your business details above before choosing.
                  </p>
                )}
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="rounded-2xl bg-teal-950 p-6 text-white">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <p className="text-sm text-teal-200">
                    {structureNames[plan.structure]} • {plan.profile.county} •{" "}
                    {plan.profile.municipality}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">
                    {plan.completedAt
                      ? "Business setup checklist complete"
                      : `${stats.completed} of ${stats.total} requirements complete`}
                  </h2>
                  <p className="mt-2 text-sm text-teal-100">
                    {plan.completedAt
                      ? `Owner-reviewed on ${plan.completedAt.slice(0, 10)}. Documents and recurring obligations remain available.`
                      : "Approval status is owner-maintained. Keep working from your last saved step."}
                  </p>
                </div>
                <span className="text-4xl font-semibold">{stats.percent}%</span>
              </div>
              <progress
                className="mt-5 h-2 w-full accent-teal-300"
                value={stats.percent}
                max={100}
                aria-label="Business setup progress"
              />
              <div className="mt-5 grid gap-4 text-sm sm:grid-cols-4">
                <p>
                  Pending approval
                  <strong className="mt-1 block text-xl">{stats.pending}</strong>
                </p>
                <p>
                  Known initial fees
                  <strong className="mt-1 block text-xl">
                    {money(stats.knownCents)}
                  </strong>
                </p>
                <p>
                  Unquoted costs
                  <strong className="mt-1 block text-xl">{stats.unquoted}</strong>
                </p>
                <p>
                  Next deadline
                  <strong className="mt-1 block">
                    {stats.deadlines[0]?.date ?? "Not recorded"}
                  </strong>
                </p>
              </div>
            </section>
            <div className="flex flex-wrap gap-3">
              <button
                className="ops-button secondary"
                onClick={() => void navigate("summary")}
              >
                Review Summary
              </button>
              <button
                className="ops-button secondary"
                onClick={() => void navigate("profile")}
              >
                Business profile
              </button>
              {state.owner && (
                <button
                  className="ops-button secondary"
                  onClick={() => setShowChange(!showChange)}
                >
                  Change Business Type
                </button>
              )}
            </div>
            {showChange && (
              <section className={panelClass}>
                <h2 className="text-xl font-semibold">
                  {plan.filingsStartedAt
                    ? "Guided structure transition"
                    : "Change your selected process"}
                </h2>
                <p className="mt-3 text-sm">
                  {plan.filingsStartedAt
                    ? "A filing has been recorded. First obtain a review of legal ownership, assignments, EIN and state registrations, bank and Stripe ownership. A new checklist will preserve the original records and will not reuse completed filings or tax IDs."
                    : "Changing type starts a new checklist. County DBA tasks are replaced by LLC formation tasks, or vice versa. All documents and history are preserved."}
                </p>
                {plan.filingsStartedAt ? (
                  <>
                    <label className="mt-4 block text-sm">
                      Target structure
                      <select
                        className={fieldClass}
                        value={preview}
                        onChange={(e) => setPreview(e.target.value as Structure)}
                      >
                        {(["SOLE", "LLC"] as const).map((s) => (
                          <option key={s} value={s}>
                            {structureNames[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="mt-4 block text-sm">
                      Reason and items requiring review
                      <textarea
                        className={fieldClass}
                        value={transitionReason}
                        onChange={(e) => setTransitionReason(e.target.value)}
                        maxLength={2000}
                      />
                    </label>
                    <button
                      className="ops-button mt-4"
                      disabled={busy}
                      onClick={() =>
                        void act({
                          action: "transition",
                          target: preview,
                          reason: transitionReason,
                        })
                      }
                    >
                      Save transition review request
                    </button>
                  </>
                ) : (
                  <button
                    className="ops-button mt-4"
                    disabled={busy}
                    onClick={() =>
                      void act({ action: "change", acknowledge: true }, () =>
                        setShowChange(false),
                      )
                    }
                  >
                    I understand — return to structure choice
                  </button>
                )}
              </section>
            )}
            {state.data.transition && (
              <section className={panelClass}>
                <h2 className="text-xl font-semibold">
                  Transition awaiting owner review
                </h2>
                <p className="my-3 text-sm">
                  Requested {state.data.transition.target}: {state.data.transition.reason}
                  . The current legal profile remains intact.
                </p>
                <ProfileForm
                  key={state.data.transition.requestedAt}
                  initial={state.data.transition.draftProfile}
                  onSave={async (p) => {
                    await command({
                      action: "transition-draft",
                      profile: p,
                      reviewNotes,
                    });
                    setTransitionProfile(p);
                  }}
                  onContinue={() => {}}
                  buttonLabel="Retain transition draft for review"
                  autosave={true}
                />
                <label className="mt-4 block text-sm">
                  Reviewer, review date, confirmed legal owner, new/retained registrations
                  and required consents
                  <textarea
                    className={fieldClass}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    onBlur={() =>
                      void act({
                        action: "transition-draft",
                        profile: transitionProfile,
                        reviewNotes,
                      })
                    }
                    maxLength={2000}
                  />
                </label>
                <button
                  className="ops-button mt-4"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      {
                        action: "transition-reviewed",
                        profile: transitionProfile,
                        reviewNotes,
                        acknowledge: true,
                      },
                      () => {
                        setScreen("");
                        setShowChange(false);
                      },
                    )
                  }
                >
                  Owner confirms review — start separate checklist
                </button>
              </section>
            )}
            {state.data.transition ? null : screen === "profile" ? (
              <section className={panelClass}>
                <h2 className="text-xl font-semibold">Saved legal profile</h2>
                {plan.filingsStartedAt ? (
                  <dl className="mt-4 space-y-3 text-sm">
                    {Object.entries(plan.profile).map(([k, v]) => (
                      <div key={k}>
                        <dt className="font-semibold">{k}</dt>
                        <dd className="break-words">
                          {Array.isArray(v) ? v.join(", ") : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <ProfileForm
                    initial={plan.profile}
                    onSave={async (p) => {
                      await command({ action: "profile", profile: p });
                    }}
                    onContinue={() => setScreen("")}
                    buttonLabel="Back to checklist"
                  />
                )}
              </section>
            ) : screen === "summary" ? (
              <section className={panelClass}>
                <h2 className="text-2xl font-semibold">Review your setup summary</h2>
                <p className="mt-2 text-sm">
                  {plan.profile.tradeName} • Legal owner: {plan.profile.legalOwner}
                </p>
                <p className="mt-3 text-sm">
                  Recorded amount paid: {money(stats.paidCents)}. Known recurring fees:{" "}
                  {money(stats.recurringKnownCents)}. {stats.unquoted} costs still need
                  quotes.
                </p>
                <ul className="mt-5 divide-y divide-slate-100">
                  {state.definitions.map((d) => (
                    <li
                      key={d.key}
                      className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                    >
                      <button
                        className="text-left font-medium text-teal-800 underline"
                        onClick={() => void navigate(d.key)}
                      >
                        {d.title}
                      </button>
                      <span>
                        {statusNames[plan.tasks[d.key]?.status ?? "NOT_STARTED"]}
                      </span>
                    </li>
                  ))}
                </ul>
                <h3 className="mt-5 font-semibold">Upcoming / recurring deadlines</h3>
                <ul className="mt-2 text-sm">
                  {stats.deadlines.map((d) => (
                    <li key={d.label}>
                      {d.date} — {d.label}
                    </li>
                  ))}
                </ul>
                {stats.outstanding.length > 0 && (
                  <p className="mt-4 text-sm">
                    Next action: {stats.outstanding[0].nextAction}
                  </p>
                )}
                <label className="mt-5 flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I reviewed the applicable requirements and supporting records.
                  Completion is a checklist status, not government certification or a
                  guarantee of legal compliance.
                </label>
                <button
                  className="ops-button mt-4"
                  disabled={
                    busy || !reviewed || !state.owner || stats.completed !== stats.total
                  }
                  onClick={() => void act({ action: "finish", reviewed: true })}
                >
                  Finish Business Setup
                </button>
                <p className="mt-3 text-sm text-slate-600">
                  Finishing does not open ordering, enable live payments or change
                  operations.
                </p>
              </section>
            ) : (
              <div className="grid min-w-0 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
                <nav
                  className={`${panelClass} self-start`}
                  aria-label="Business setup checklist"
                >
                  <ol className="space-y-1">
                    {state.definitions.map((d, i) => (
                      <li key={d.key}>
                        <button
                          className={`w-full rounded-lg p-3 text-left text-sm ${selected?.key === d.key ? "bg-teal-900 text-white" : "hover:bg-teal-50"}`}
                          onClick={() => void navigate(d.key)}
                        >
                          {i + 1}. {d.title}
                          <span className="mt-1 block text-xs opacity-80">
                            {statusNames[plan.tasks[d.key]?.status ?? "NOT_STARTED"]}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </nav>
                <div className="min-w-0 space-y-4">
                  {selected && (
                    <StepForm
                      key={`${plan.id}:${selected.key}`}
                      plan={plan}
                      definition={selected}
                      documents={documents.documents}
                      onSave={async (task) => {
                        await command({ action: "step", key: selected.key, task });
                      }}
                      onBack={() => {
                        const i = state.definitions.findIndex(
                          (d) => d.key === selected.key,
                        );
                        setScreen(state.definitions[Math.max(0, i - 1)].key);
                      }}
                      onContinue={() => {
                        const i = state.definitions.findIndex(
                          (d) => d.key === selected.key,
                        );
                        setScreen(state.definitions[i + 1]?.key ?? "summary");
                      }}
                    />
                  )}
                  {selected?.key === "suppliers" && (
                    <section className={panelClass}>
                      <h3 className="font-semibold">Add a supplier certificate record</h3>
                      <label className="mt-3 block text-sm">
                        Supplier name
                        <input
                          className={fieldClass}
                          value={supplier}
                          onChange={(e) => setSupplier(e.target.value)}
                          maxLength={160}
                        />
                      </label>
                      <button
                        className="ops-button mt-4"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            {
                              action: "supplier",
                              supplier: {
                                name: supplier,
                                deliveredDate: "",
                                acceptedDate: "",
                                notes: "",
                              },
                            },
                            () => setSupplier(""),
                          )
                        }
                      >
                        Add supplier
                      </button>
                    </section>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        <details className={panelClass}>
          <summary className="cursor-pointer text-sm font-semibold">
            Saved history and access
          </summary>
          <p className="mt-3 text-sm">
            Version {state.version}. Previous structure records and documents are retained
            privately.
          </p>
          <ol className="mt-3 space-y-1 text-xs">
            {state.history.map((h) => (
              <li key={h.version}>
                Version {h.version} — {h.action} —{" "}
                {new Date(h.createdAt).toLocaleString()}
              </li>
            ))}
          </ol>
          {state.owner && (
            <div className="mt-5">
              <label className="text-sm">
                Existing administrator email
                <input
                  className={fieldClass}
                  type="email"
                  value={accessEmail}
                  onChange={(e) => setAccessEmail(e.target.value)}
                />
              </label>
              <p className="my-2 text-xs">
                Explicit access includes sensitive business documents and checklist edits.
                The owner retains structure, completion and deletion controls.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="ops-button secondary"
                  disabled={busy}
                  onClick={() =>
                    void act({ action: "access", email: accessEmail, grant: true })
                  }
                >
                  Grant business access
                </button>
                <button
                  className="ops-button secondary"
                  disabled={busy}
                  onClick={() =>
                    void act({ action: "access", email: accessEmail, grant: false })
                  }
                >
                  Revoke business access
                </button>
              </div>
            </div>
          )}
        </details>
      </div>
    </SaveNavigation.Provider>
  );
}
