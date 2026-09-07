"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCents } from "@/lib/domain/money";
import { adminFetch } from "@/lib/admin-fetch";

type Item = {
  id: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostCents: number;
  productVariant: { sku: string; upc: string | null; name: string; product: { name: string } };
};
type PurchaseOrder = {
  id: string;
  number: string;
  status: string;
  vendor: { name: string };
  items: Item[];
};

export function ReceivingDesk({ purchaseOrders }: { purchaseOrders: PurchaseOrder[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(purchaseOrders[0]?.id ?? "");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return purchaseOrders;
    return purchaseOrders.filter((po) => {
      if (po.number.toLowerCase().includes(needle)) return true;
      return po.items.some(
        (item) =>
          item.productVariant.sku.toLowerCase().includes(needle) ||
          (item.productVariant.upc ?? "").toLowerCase().includes(needle),
      );
    });
  }, [purchaseOrders, query]);

  const selected = filtered.find((po) => po.id === selectedId) ?? filtered[0];

  async function receive(formData: FormData) {
    if (!selected) return;
    setError(null);
    const lines = selected.items
      .map((item) => ({
        purchaseOrderItemId: item.id,
        quantityReceived: Number(formData.get(`good-${item.id}`) || 0),
        quantityDamaged: Number(formData.get(`damaged-${item.id}`) || 0),
        quantityShortage: Number(formData.get(`shortage-${item.id}`) || 0),
        quantityOverage: Number(formData.get(`overage-${item.id}`) || 0),
        costDiscrepancyNotes: String(formData.get(`notes-${item.id}`) ?? "") || null,
      }))
      .filter(
        (line) =>
          line.quantityReceived +
            line.quantityDamaged +
            line.quantityShortage +
            line.quantityOverage >
          0,
      );
    try {
      await adminFetch("/api/receiving", {
        method: "POST",
        body: JSON.stringify({
          purchaseOrderId: selected.id,
          notes: String(formData.get("notes") ?? "") || null,
          lines,
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receive failed");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-teal-950">Scan or search SKU / UPC / PO</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="PO-… or barcode"
            autoFocus
          />
        </label>
      </Card>
      {error ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>
      ) : null}
      {filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-teal-800">No open purchase orders match that search.</p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <div className="space-y-2">
            {filtered.map((po) => (
              <button
                key={po.id}
                type="button"
                onClick={() => setSelectedId(po.id)}
                className={`w-full rounded-2xl border px-3 py-3 text-left ${
                  selected?.id === po.id
                    ? "border-teal-600 bg-teal-50"
                    : "border-teal-100 bg-white"
                }`}
              >
                <p className="text-sm font-semibold text-teal-950">{po.number}</p>
                <p className="text-xs text-teal-700">
                  {po.vendor.name} · {po.status}
                </p>
              </button>
            ))}
          </div>
          {selected ? (
            <form action={receive} className="space-y-4">
              <Card>
                <p className="font-semibold text-teal-950">{selected.number}</p>
                <p className="text-sm text-teal-700">{selected.vendor.name}</p>
              </Card>
              {selected.items.map((item) => {
                const remaining = Math.max(item.quantityOrdered - item.quantityReceived, 0);
                return (
                  <Card key={item.id} className="space-y-3">
                    <div>
                      <p className="font-semibold text-teal-950">{item.productVariant.product.name}</p>
                      <p className="text-xs text-teal-700">
                        {item.productVariant.sku}
                        {item.productVariant.upc ? ` · ${item.productVariant.upc}` : ""} · ordered{" "}
                        {item.quantityOrdered} · received {item.quantityReceived} · {formatCents(item.unitCostCents)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <label className="text-xs text-teal-800">
                        Good
                        <Input
                          name={`good-${item.id}`}
                          type="number"
                          min={0}
                          defaultValue={remaining}
                        />
                      </label>
                      <label className="text-xs text-teal-800">
                        Damaged
                        <Input name={`damaged-${item.id}`} type="number" min={0} defaultValue={0} />
                      </label>
                      <label className="text-xs text-teal-800">
                        Shortage
                        <Input name={`shortage-${item.id}`} type="number" min={0} defaultValue={0} />
                      </label>
                      <label className="text-xs text-teal-800">
                        Overage
                        <Input name={`overage-${item.id}`} type="number" min={0} defaultValue={0} />
                      </label>
                    </div>
                    <Textarea
                      name={`notes-${item.id}`}
                      placeholder="Cost discrepancy or condition notes"
                    />
                  </Card>
                );
              })}
              <Card>
                <Textarea name="notes" placeholder="Receipt notes" />
                <Button type="submit" className="mt-4 w-full sm:w-auto">
                  Post receipt
                </Button>
              </Card>
            </form>
          ) : null}
        </div>
      )}
    </div>
  );
}
