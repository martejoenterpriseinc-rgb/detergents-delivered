import { CatalogError } from "@/lib/services/catalog";
import { InventoryError } from "@/lib/domain/inventory";
import { MoneyError } from "@/lib/domain/money";
import { AdjustmentError } from "@/lib/services/inventory";
import { PurchasingError } from "@/lib/services/purchasing";
import { ReceivingError } from "@/lib/services/receiving";
import { VendorError } from "@/lib/services/vendors";

function statusForMessage(message: string) {
  if (message.includes("not found")) return 404;
  return 409;
}

export function serviceErrorResponse(error: unknown) {
  if (
    error instanceof CatalogError ||
    error instanceof VendorError ||
    error instanceof PurchasingError ||
    error instanceof ReceivingError ||
    error instanceof AdjustmentError ||
    error instanceof InventoryError ||
    error instanceof MoneyError
  ) {
    return Response.json({ error: error.message }, { status: statusForMessage(error.message) });
  }
  if (
    typeof error === "object" &&
    error &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return Response.json({ error: "a unique field is already in use" }, { status: 409 });
  }
  throw error;
}
