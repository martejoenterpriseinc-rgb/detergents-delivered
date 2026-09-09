"use client";
import { PurchaseCheck } from "./purchase-check";
export type DeliveryCheckerConfig = {
  enabledCountyCodes: readonly string[];
  nextWindowLabel?: string | null;
  exampleZip?: string;
  exampleZips?: readonly string[];
};
export function DeliveryChecker({
  defaultZip = "",
  onResult,
}: {
  defaultZip?: string;
  compact?: boolean;
  onResult?: (ok: boolean, zip: string) => void;
  config?: DeliveryCheckerConfig;
}) {
  return <PurchaseCheck initialZip={defaultZip} onArea={onResult} />;
}
