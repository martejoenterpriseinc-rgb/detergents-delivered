"use client";

import { useMemo, useState } from "react";
import { checkDeliveryZip, EXAMPLE_DELIVERY_ZIP } from "@/lib/delivery-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type DeliveryCheckerConfig = {
  enabledCountyCodes: readonly string[];
  nextWindowLabel?: string | null;
  exampleZip?: string;
  exampleZips?: readonly string[];
};

export function DeliveryChecker({
  defaultZip = "",
  compact = false,
  onResult,
  config,
}: {
  defaultZip?: string;
  compact?: boolean;
  onResult?: (ok: boolean, zip: string) => void;
  config?: DeliveryCheckerConfig;
}) {
  const [zip, setZip] = useState(defaultZip);
  const [submitted, setSubmitted] = useState(defaultZip);
  const enabledCountyCodes = config?.enabledCountyCodes;
  const nextWindowLabel = config?.nextWindowLabel;
  const result = useMemo(
    () =>
      submitted
        ? checkDeliveryZip(submitted, { enabledCountyCodes, nextWindowLabel })
        : null,
    [submitted, enabledCountyCodes, nextWindowLabel],
  );
  const exampleZip = config?.exampleZip ?? EXAMPLE_DELIVERY_ZIP;
  const previewZips = (config?.exampleZips ?? []).slice(0, 4);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(zip);
        const next = checkDeliveryZip(zip, { enabledCountyCodes, nextWindowLabel });
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
            placeholder={exampleZip}
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
          Weekly delivery on scheduled route days
          {config?.nextWindowLabel ? ` — next window ${config.nextWindowLabel}` : ""}.
          {previewZips.length > 0
            ? ` Listed ZIPs include ${previewZips.join(", ")}.`
            : ` Try ${exampleZip}.`}
        </p>
      )}
    </form>
  );
}
