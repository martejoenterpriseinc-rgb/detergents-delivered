"use client";
import Link from "next/link";
import { useRef, useState } from "react";
export function PurchaseCheck({
  onEligibility,
  onPurchase,
  initialZip = "",
  onArea,
}: {
  onPurchase?: (value: boolean) => void;
  onEligibility?: (value: boolean) => void;
  initialZip?: string;
  onArea?: (value: boolean, zip: string) => void;
}) {
  const [zip, setZip] = useState(initialZip);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sequence = useRef(0);
  async function check() {
    const attempt = ++sequence.current;
    setBusy(true);
    setMessage("");
    onEligibility?.(false);
    onPurchase?.(false);
    try {
      const response = await fetch(
        `/api/purchase-eligibility?zip=${encodeURIComponent(zip)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Delivery check is unavailable.");
      if (sequence.current !== attempt) return;
      setMessage(data.message);
      onEligibility?.(data.eligible === true);
      onPurchase?.(data.canPurchase === true);
      onArea?.(data.areaAvailable === true, zip);
    } catch (e) {
      if (sequence.current === attempt) {
        setMessage(
          e instanceof Error
            ? e.message
            : "Unable to verify delivery availability. Try again.",
        );
        onArea?.(false, zip);
      }
    } finally {
      if (sequence.current === attempt) setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-2xl border border-teal-200 bg-white p-4">
      <label className="block text-sm font-semibold">
        Delivery ZIP
        <input
          aria-label="Delivery ZIP"
          value={zip}
          maxLength={5}
          inputMode="numeric"
          autoComplete="postal-code"
          onChange={(e) => {
            ++sequence.current;
            setBusy(false);
            setZip(e.target.value);
            setMessage("");
            onEligibility?.(false);
            onPurchase?.(false);
            onArea?.(false, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void check();
            }
          }}
          className="mt-2 block h-11 w-full rounded-xl border border-teal-200 px-3"
        />
      </label>
      <button
        type="button"
        className="ops-button"
        disabled={busy || !/^\d{5}$/.test(zip)}
        onClick={() => void check()}
      >
        {busy ? "Checking…" : "Check my area"}
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <p className="text-xs">
        An approved account and validated delivery address are required.{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>{" "}
        ·{" "}
        <Link href="/contact" className="underline">
          Contact us
        </Link>
      </p>
    </div>
  );
}
