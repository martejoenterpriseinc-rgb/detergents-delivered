"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section role="alert" className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Payments could not be refreshed</h1>
      <p>Current totals are unavailable. Retry before relying on this report.</p>
      <button onClick={reset} className="ops-button">
        Retry payments
      </button>
      <Link href="/admin/payments" className="block underline">
        Reset filters
      </Link>
    </section>
  );
}
