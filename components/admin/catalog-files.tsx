"use client";
import { useRef, useState } from "react";
type Preview = {
  previewHash: string;
  products: number;
  variants: number;
  rows: { productName: string; sku: string; variantName: string; amountCents: number }[];
};
export function CatalogFiles({ canImport }: { canImport: boolean }) {
  const fileGeneration = useRef(0);
  const [csv, setCsv] = useState(""),
    [fileName, setFileName] = useState(""),
    [prefix, setPrefix] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const request = async (apply: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/catalog-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          apply
            ? {
                action: "apply",
                csv,
                requestKey: key,
                previewHash: preview?.previewHash,
                confirmed: true,
              }
            : { action: "preview", csv },
        ),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Catalog file request failed.");
      if (apply) {
        setMessage(
          `Imported ${data.products} draft products and ${data.variants} variants. Review them in Inventory before activation.`,
        );
        setPreview(null);
        setCsv("");
        setConfirmed(false);
      } else {
        setPreview(data);
        setConfirmed(false);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Import could not be confirmed. Retry the same file.",
      );
    } finally {
      setBusy(false);
    }
  };
  const exportHref = (kind: string) =>
    "/api/admin/catalog-files?" + new URLSearchParams({ kind, prefix });
  return (
    <div className="space-y-6">
      <section
        className="space-y-3 rounded-xl border bg-white p-5"
        aria-label="Catalog exports"
      >
        <h2 className="text-xl font-semibold">Export saved catalog and stock</h2>
        <p className="text-sm text-slate-600">
          Exports include active and inactive variants. A blank retail price means there
          is no single current USD retail price. Stock quantities come from saved
          balances.
        </p>
        <label className="grid max-w-sm gap-1 text-sm">
          SKU prefix (optional)
          <input
            className="rounded border p-2"
            maxLength={80}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <a className="ops-button" href={exportHref("catalog")}>
            Export catalog CSV
          </a>
          <a className="ops-button secondary" href={exportHref("stock")}>
            Export stock CSV
          </a>
        </div>
      </section>
      {canImport ? (
        <section
          className="space-y-3 rounded-xl border bg-white p-5"
          aria-label="Catalog import"
        >
          <h2 className="text-xl font-semibold">Import new draft products</h2>
          <p className="text-sm text-slate-600">
            Use one row per variant and the same product key for variants of one product.
            Imports create inactive, unpublished products with zero stock. Existing
            product keys and SKUs are rejected. Up to 100 rows and 12 KB per file.
          </p>
          <a className="underline" href="/api/admin/catalog-files?kind=template">
            Download import template
          </a>
          <label className="grid gap-1 text-sm">
            Catalog CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              className="w-full min-w-0 rounded border p-2"
              onChange={async (e) => {
                const generation = ++fileGeneration.current;
                const file = e.target.files?.[0];
                setPreview(null);
                setCsv("");
                setConfirmed(false);
                setMessage("");
                setFileName(file?.name ?? "");
                setKey(crypto.randomUUID());
                if (!file) return;
                if (file.size > 12_000) {
                  setMessage("Choose a CSV file no larger than 12 KB.");
                  return;
                }
                try {
                  const text = await file.text();
                  if (generation === fileGeneration.current) setCsv(text);
                } catch {
                  setMessage("The file could not be read. Choose it again.");
                }
              }}
            />
          </label>
          {fileName && <p className="text-sm break-all">Selected: {fileName}</p>}
          <button
            className="ops-button secondary"
            disabled={busy || !csv}
            onClick={() => request(false)}
          >
            {busy ? "Working…" : "Preview import"}
          </button>
          {preview && (
            <div className="space-y-3">
              <p className="font-semibold">
                Review {preview.products} new products and {preview.variants} variants
              </p>
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {preview.rows.map((row) => (
                  <article key={row.sku} className="rounded border p-3">
                    <p className="font-medium break-words">
                      {row.productName} · {row.variantName}
                    </p>
                    <p className="text-sm break-all">
                      {row.sku} · {(row.amountCents / 100).toFixed(2)} USD
                    </p>
                  </article>
                ))}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1"
                />
                I reviewed these rows and want to create inactive draft products.
              </label>
              <button
                className="ops-button"
                disabled={busy || !confirmed}
                onClick={() => request(true)}
              >
                Import reviewed drafts
              </button>
            </div>
          )}
        </section>
      ) : (
        <p className="text-sm">
          Your accounting role can export records. Catalog imports require catalog
          management access.
        </p>
      )}
      {message && (
        <p role="alert" className="rounded border bg-white p-4">
          {message}
        </p>
      )}
    </div>
  );
}
