import { AccountError } from "@/lib/domain/account";
import { integrationEnvironment } from "@/lib/integration-environment";

// Server-only capability. Never accepted from JSON, a user ID, or an HTTP request.
export const refundWorkerAuthority = Symbol("refund-reconciliation-worker");
export type RefundActor = string | typeof refundWorkerAuthority;
export function assertRefundWorkerEnvironment() {
  if (!integrationEnvironment())
    throw new AccountError("Worker environment is not configured.", 503);
}
export function refundAuditActor(actor: RefundActor) {
  return typeof actor === "string" ? actor : undefined;
}
