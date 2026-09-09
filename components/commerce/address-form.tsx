"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-fetch";
import { Button } from "@/components/ui/button";
export function AddressForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  return (
    <form
      className="space-y-4 rounded-2xl border bg-white p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true);
        setError("");
        setSaved(false);
        try {
          await adminFetch("/api/account/addresses", {
            method: "POST",
            body: JSON.stringify({
              line1: f.get("line1"),
              line2: f.get("line2"),
              city: f.get("city"),
              region: "IL",
              postalCode: f.get("postalCode"),
            }),
          });
          setSaved(true);
          form.reset();
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Save unavailable.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-xl font-semibold">Add a delivery address</h2>
      <p>
        Our team reviews the location before it can be used for orders. Existing order
        addresses stay unchanged.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        {[
          ["line1", "Street address"],
          ["line2", "Apartment or suite (optional)"],
          ["city", "City"],
          ["postalCode", "ZIP code"],
        ].map(([name, label]) => (
          <label className="block" key={name}>
            {label}
            <input
              className="mt-1 block w-full rounded-xl border p-3"
              name={name}
              required={name !== "line2"}
              maxLength={150}
            />
          </label>
        ))}
        <p>State: Illinois</p>
        <Button disabled={busy}>Save address for review</Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">Address saved and awaiting review.</p>}
    </form>
  );
}
