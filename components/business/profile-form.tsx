"use client";
import { useRouter } from "next/navigation";
import type { BusinessProfile } from "@/lib/business/domain";
import { fieldClass, panelClass, SaveFeedback, useSavedForm } from "./shared";
export function ProfileForm({
  initial,
  onSave,
  onContinue,
  buttonLabel = "Continue to structure choice",
  autosave = true,
}: {
  initial: BusinessProfile;
  onSave: (p: BusinessProfile) => Promise<void>;
  onContinue: () => void;
  buttonLabel?: string;
  autosave?: boolean;
}) {
  const router = useRouter();
  // Transition profiles use the same draft form, but onSave only updates the local reviewed draft.
  const f = useSavedForm(initial, onSave);
  const p = f.value;
  function set<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) {
    f.edit({ ...p, [key]: value });
  }
  return (
    <section className={panelClass} aria-labelledby="business-profile-heading">
      <h2 id="business-profile-heading" className="text-xl font-semibold">
        Your business details
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Confirm the operating location and actual legal owner. County and municipality are
        never inferred from ZIP code.
      </p>
      <fieldset disabled={f.busy} className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
        {(
          [
            ["tradeName", "Business / trade name"],
            ["legalOwner", "Actual legal owner or approved LLC legal name"],
            ["address", "Operating street address"],
            ["state", "State"],
            ["county", "County"],
            ["municipality", "Municipality"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="text-sm font-medium">
            {label}
            <input
              className={fieldClass}
              value={p[k]}
              onChange={(e) => set(k, e.target.value)}
              autoComplete="off"
              maxLength={k === "address" ? 2000 : 160}
            />
          </label>
        ))}
        <label className="text-sm font-medium">
          Number of owners
          <input
            className={fieldClass}
            type="number"
            min="1"
            max="100"
            value={p.owners}
            onChange={(e) => set("owners", Number(e.target.value) || 1)}
          />
        </label>
        <label className="text-sm font-medium">
          Operating premises
          <select
            className={fieldClass}
            value={p.premises}
            onChange={(e) =>
              set("premises", e.target.value as BusinessProfile["premises"])
            }
          >
            <option value="">Choose…</option>
            <option value="HOME">Home-based</option>
            <option value="COMMERCIAL">Commercial</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Product handling
          <select
            className={fieldClass}
            value={p.products}
            onChange={(e) =>
              set("products", e.target.value as BusinessProfile["products"])
            }
          >
            <option value="">Choose…</option>
            <option value="SEALED">Purchased sealed for resale</option>
            <option value="MANUFACTURE">Manufacture products</option>
            <option value="REBOTTLE">Rebottle products</option>
            <option value="RELABEL">Relabel products</option>
          </select>
        </label>
        {(
          [
            ["employees", "Will you hire employees?"],
            ["transfers", "Will assets or contracts transfer from an existing business?"],
            [
              "assumedName",
              "Will the operating name differ from the legal owner / LLC name?",
            ],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="text-sm font-medium">
            {label}
            <select
              className={fieldClass}
              value={p[k]}
              onChange={(e) => set(k, e.target.value as "YES" | "NO" | "")}
            >
              <option value="">Choose…</option>
              <option value="YES">Yes</option>
              <option value="NO">No</option>
            </select>
          </label>
        ))}
        <label className="flex items-start gap-2 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            checked={p.stateConfirmed}
            onChange={(e) => set("stateConfirmed", e.target.checked)}
          />
          I confirm the state, county and municipality above.
        </label>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-semibold">
            Already have these? Record existing evidence instead of applying twice.
          </p>
          <div className="flex flex-wrap gap-4">
            {(
              [
                "formation",
                "dba",
                "ein",
                "illinois",
                "bank",
                "insurance",
                "stripe",
              ] as const
            ).map((k) => (
              <label key={k} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={p.existing.includes(k)}
                  onChange={(e) =>
                    set(
                      "existing",
                      e.target.checked
                        ? [...p.existing, k]
                        : p.existing.filter((x) => x !== k),
                    )
                  }
                />
                {
                  {
                    formation: "LLC formation",
                    dba: "County DBA",
                    ein: "EIN",
                    illinois: "Illinois registration",
                    bank: "Bank account",
                    insurance: "Insurance",
                    stripe: "Stripe account",
                  }[k]
                }
              </label>
            ))}
          </div>
          <label className="mt-4 flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.existingConfirmed}
              onChange={(e) => set("existingConfirmed", e.target.checked)}
            />
            I reviewed existing accounts and registrations; unchecked items are not
            already established.
          </label>
        </div>
      </fieldset>
      {p.owners > 1 && (
        <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3">
          Multiple owners need a different-structure review. Neither single-owner process
          can be selected.
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <SaveFeedback
          feedback={autosave ? f.feedback : "Transition draft — owner review required"}
          error={f.error}
        />
        <button
          className="ops-button"
          disabled={f.busy}
          onClick={async () => {
            if (await f.flush()) onContinue();
          }}
        >
          {buttonLabel}
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
      </div>
    </section>
  );
}
