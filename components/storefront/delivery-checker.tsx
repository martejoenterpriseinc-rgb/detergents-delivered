"use client";

import { useMemo, useState } from "react";
import { checkDeliveryZip, DEMO_DELIVERY_ZIPS } from "@/lib/delivery-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function DeliveryChecker({
  defaultZip = "",
  compact = false,
  onResult,
}: {
  defaultZip?: string;
  compact?: boolean;
  onResult?: (ok: boolean, zip: string) => void;
}) {
  const [zip, setZip] = useState(defaultZip);
  const [submitted, setSubmitted] = useState(defaultZip);
  const result = useMemo(
    () => (submitted ? checkDeliveryZip(submitted) : null),
    [submitted],
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(zip);
        const next = checkDeliveryZip(zip);
        onResult?.(next.ok, next.zip);
      }}
    >
      <div
        className={cn("flex flex-col gap-2", compact ? "sm:flex-row sm:items-end" : "")}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="delivery-zip">Delivery ZIP</Label>
          <Input
            id="delivery-zip"
            name="zip"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="50309"
            value={zip}
            onChange={(event) => setZip(event.target.value)}
          />
        </div>
        <Button type="submit" className="sm:w-auto">
          Check my area
        </Button>
      </div>
      {result ? (
        <p
          className={cn(
            "rounded-2xl px-4 py-3 text-sm",
            result.ok ? "bg-teal-50 text-teal-950" : "bg-rose-50 text-rose-900",
          )}
        >
          {result.message}
        </p>
      ) : (
        <p className="text-xs text-teal-700">
          Demo ZIPs include {DEMO_DELIVERY_ZIPS.slice(0, 4).join(", ")}, and more on the
          delivery area page.
        </p>
      )}
    </form>
  );
}
