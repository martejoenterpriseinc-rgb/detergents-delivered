"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-fetch";
import { dollarsToCents } from "@/lib/domain/loyalty";
import type { PromotionTerms } from "@/lib/domain/promotions";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/admin/field";
export function PromotionSettings({ initial }: { initial: PromotionTerms[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<PromotionTerms | null>(null);
  const [type, setType] = useState("PERCENT");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="space-y-5">
      <h2 className="text-2xl font-semibold">Purchase promotions</h2>
      <p>
        Offer dollars or a percentage off merchandise for a selected period. Referral
        credits remain in the customer’s wallet. Promotions reduce merchandise before tax;
        optional rewards then cover only the amount needed. Checkout currently quotes
        these rules without spending credits.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="ops-button secondary"
          onClick={() => {
            setSelected(null);
            setType("PERCENT");
          }}
        >
          New promotion
        </button>
        {initial.map((p) => (
          <button
            key={p.code}
            className="ops-button secondary"
            onClick={() => {
              setSelected(p);
              setType(p.valueType);
            }}
          >
            {p.code} · {p.isActive ? "Enabled" : "Paused"}
          </button>
        ))}
      </div>
      <form
        key={selected?.code ?? "new"}
        className="space-y-4 rounded-3xl border border-teal-100 bg-white p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          setError("");
          try {
            const f = new FormData(e.currentTarget);
            const code = String(f.get("code")).toUpperCase();
            await adminFetch("/api/admin/promotions", {
              method: "POST",
              body: JSON.stringify({
                code,
                name: String(f.get("name")),
                valueType: type,
                value: dollarsToCents(String(f.get("value"))),
                startsOn: f.get("startsOn"),
                endsOn: f.get("endsOn"),
                minimumPurchaseCents: dollarsToCents(String(f.get("minimum") || "0")),
                maximumDiscountCents: f.get("maximum")
                  ? dollarsToCents(String(f.get("maximum")))
                  : null,
                audience: f.get("audience"),
                allowRewards: f.get("allowRewards") === "on",
                isActive: f.get("isActive") === "on",
                version: selected?.version ?? 0,
              }),
            });
            setMessage(
              "Promotion saved. Historical orders and earned rewards are unchanged.",
            );
            setSelected(null);
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Promotion could not be saved.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <Field label="Promo code">
            <Input
              name="code"
              required
              readOnly={Boolean(selected)}
              defaultValue={selected?.code}
              pattern="[A-Za-z0-9_-]{3,32}"
            />
          </Field>
          <Field label="Promotion name">
            <Input name="name" required maxLength={120} defaultValue={selected?.name} />
          </Field>
          <Field label="Discount type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-11 w-full rounded-xl border border-teal-200 px-3"
            >
              <option value="PERCENT">Percentage off</option>
              <option value="FIXED">Dollars off</option>
            </select>
          </Field>
          <Field
            label={type === "PERCENT" ? "Percent off (e.g. 10 = 10%)" : "Dollars off"}
          >
            <Input
              name="value"
              inputMode="decimal"
              required
              defaultValue={selected ? (selected.value / 100).toFixed(2) : ""}
            />
          </Field>
          <Field label="Starts on (Chicago)">
            <Input
              name="startsOn"
              type="date"
              required
              defaultValue={selected?.startsOn}
            />
          </Field>
          <Field label="Ends on, inclusive (Chicago)">
            <Input name="endsOn" type="date" required defaultValue={selected?.endsOn} />
          </Field>
          <Field label="Minimum purchase for this promotion ($)">
            <Input
              name="minimum"
              inputMode="decimal"
              defaultValue={
                selected ? (selected.minimumPurchaseCents / 100).toFixed(2) : "0"
              }
            />
          </Field>
          <Field label="Maximum discount ($, optional)">
            <Input
              name="maximum"
              inputMode="decimal"
              defaultValue={
                selected?.maximumDiscountCents
                  ? (selected.maximumDiscountCents / 100).toFixed(2)
                  : ""
              }
            />
          </Field>
          <Field label="Eligible customers">
            <select
              name="audience"
              defaultValue={selected?.audience ?? "ALL"}
              className="h-11 w-full rounded-xl border border-teal-200 px-3"
            >
              <option value="ALL">All customers</option>
              <option value="FIRST_ORDER">First purchase</option>
              <option value="REFERRED">Referred customers</option>
            </select>
          </Field>
          <div className="space-y-3">
            <label className="block">
              <input
                type="checkbox"
                name="allowRewards"
                defaultChecked={selected?.allowRewards ?? false}
              />{" "}
              Allow rewards with this promotion
            </label>
            <label className="block">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={selected?.isActive ?? false}
              />{" "}
              Enable during selected dates
            </label>
          </div>
        </fieldset>
        <button className="ops-button" disabled={busy}>
          Save promotion
        </button>
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="text-rose-900">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
