import { Prisma } from "@prisma/client";
import { AccountError } from "@/lib/domain/account";
import { integrationEnvironment } from "@/lib/integration-environment";
import { financeAccess } from "./finance";
// Server-only capability; no HTTP input or user ID can represent this value.
export const quickbooksWorkerAuthority = Symbol("quickbooks-reconciliation-worker");
export type QuickbooksActor = string | typeof quickbooksWorkerAuthority;
export async function quickbooksAccountingAccess(
  tx: Prisma.TransactionClient,
  actor: QuickbooksActor,
  write = false,
) {
  if (actor === quickbooksWorkerAuthority) {
    if (!integrationEnvironment())
      throw new AccountError("Worker environment is unavailable.", 503);
    return true;
  }
  return financeAccess(tx, actor, write);
}
export const quickbooksAuditActor = (actor: QuickbooksActor) =>
  typeof actor === "string" ? actor : undefined;
