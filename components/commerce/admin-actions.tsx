"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-fetch";
import { Button } from "@/components/ui/button";
export function ReconcileButton({ id }: { id: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await adminFetch("/api/admin/commerce", {
              method: "POST",
              body: JSON.stringify({ action: "reconcile", data: { id } }),
            });
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Review failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Recheck with Stripe
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function ApproveAddress({ id, version }: { id: string; version: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await adminFetch("/api/admin/commerce", {
            method: "POST",
            body: JSON.stringify({
              action: "approveAddress",
              data: {
                addressId: id,
                version,
                lat: Number(f.get("lat")),
                lng: Number(f.get("lng")),
                evidence: f.get("evidence"),
                confirmReviewed: f.get("confirmed") === "on",
              },
            }),
          });
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Approval failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {["lat", "lng"].map((n) => (
            <label key={n} className="block">
              {n === "lat" ? "Verified latitude" : "Verified longitude"}
              <input
                className="block w-full rounded-xl border p-2"
                name={n}
                type="number"
                step="any"
                required
              />
            </label>
          ))}
        </div>
        <label className="block">
          How was the address verified?
          <input
            className="block w-full rounded-xl border p-2"
            name="evidence"
            minLength={15}
            maxLength={500}
            required
          />
        </label>
        <label className="flex gap-2">
          <input name="confirmed" type="checkbox" required />I checked the actual address
          and delivery access.
        </label>
        <Button disabled={busy}>Approve delivery address</Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
