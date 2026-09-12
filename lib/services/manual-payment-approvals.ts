import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { canonicalJson } from "@/lib/commerce/domain";
import {
  manualPaymentApprovalInput,
  manualPaymentMethod,
} from "@/lib/domain/manual-payment-approval";
import { financeAccess } from "./finance";
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
async function customer(tx: Prisma.TransactionClient, id: string) {
  const c = await tx.customer.findFirst({
    where: { id, deletedAt: null },
    include: { user: true },
  });
  if (!c || c.user.deletedAt) throw new AccountError("Customer not found.", 404);
  return c;
}
export async function readManualPaymentApprovals(actor: string, customerId: string) {
  z.string().min(1).max(100).parse(customerId);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const canWrite = await financeAccess(tx, actor);
      const c = await customer(tx, customerId);
      const records = await tx.manualPaymentApproval.findMany({
        where: { customerId },
        orderBy: { method: "asc" },
      });
      const history = await tx.auditLog.findMany({
        where: {
          entityType: "Customer",
          entityId: customerId,
          action: "manual-payment.approval.saved",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: { createdAt: true, afterJson: true },
      });
      return {
        customerId,
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.user.email,
        canWrite,
        eligible: Boolean(
          c.purchaseApprovedAt && c.user.emailVerified && !c.user.mustChangeCredentials,
        ),
        approvals: ["CASH", "ZELLE"].map((method) => {
          const r = records.find((v) => v.method === method);
          return {
            method: manualPaymentMethod.parse(method),
            version: r?.version ?? 0,
            enabled: r?.enabled ?? false,
            maxOrderCents: r?.maxOrderCents ?? 10000,
            expiresAt: r?.expiresAt.toISOString() ?? null,
            active: Boolean(r?.enabled && r.expiresAt > new Date()),
          };
        }),
        history: history.map((h) => ({
          at: h.createdAt.toISOString(),
          ...z
            .object({
              method: manualPaymentMethod,
              enabled: z.boolean(),
              reason: z.string(),
            })
            .parse(h.afterJson),
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function saveManualPaymentApproval(actor: string, raw: unknown) {
  const d = manualPaymentApprovalInput.parse(raw);
  const id =
    "manual-approval_" +
    createHash("sha256")
      .update(actor + ":" + d.requestKey)
      .digest("hex");
  const hash = createHash("sha256").update(canonicalJson(d)).digest("hex");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor} FOR UPDATE`;
    await financeAccess(tx, actor, true);
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${d.customerId} FOR UPDATE`;
    const c = await customer(tx, d.customerId);
    const prior = await tx.auditLog.findUnique({ where: { id } });
    if (prior) {
      const p = z
        .object({ hash: z.string(), version: z.number() })
        .parse(prior.afterJson);
      if (p.hash !== hash)
        throw new AccountError(
          "This request was already used for different approval details.",
          409,
        );
      return { version: p.version };
    }
    const before = await tx.manualPaymentApproval.findUnique({
      where: { customerId_method: { customerId: d.customerId, method: d.method } },
    });
    if ((before?.version ?? 0) !== d.version)
      throw new AccountError("Approval changed. Reload before saving.", 409);
    const expiresAt = new Date(d.expiresAt),
      now = new Date();
    if (
      d.enabled &&
      (!c.purchaseApprovedAt || !c.user.emailVerified || c.user.mustChangeCredentials)
    )
      throw new AccountError(
        "Verify the customer's email and purchase approval first.",
        409,
      );
    if (
      d.enabled &&
      (expiresAt <= now || expiresAt.getTime() > now.getTime() + 90 * 86400000)
    )
      throw new AccountError("Approval must expire within the next 90 days.", 400);
    if (!d.enabled && !before)
      throw new AccountError("No approval exists to revoke.", 409);
    const fields = {
      enabled: d.enabled,
      maxOrderCents: d.enabled ? d.maxOrderCents : before!.maxOrderCents,
      expiresAt: d.enabled ? expiresAt : before!.expiresAt,
      version: d.version + 1,
    };
    await tx.manualPaymentApproval.upsert({
      where: { customerId_method: { customerId: d.customerId, method: d.method } },
      create: { customerId: d.customerId, method: d.method, ...fields },
      update: fields,
    });
    await tx.auditLog.create({
      data: {
        id,
        actorUserId: actor,
        entityType: "Customer",
        entityId: d.customerId,
        action: "manual-payment.approval.saved",
        beforeJson: before ? json(before) : Prisma.JsonNull,
        afterJson: json({ ...fields, method: d.method, reason: d.reason, hash }),
      },
    });
    return { version: fields.version };
  });
}
// Call inside the authoritative reservation/settlement transaction; lock the customer
// so a concurrent revocation cannot pass between this check and the protected write.
// This guard grants permission only; it does not settle or collect money.
export async function assertManualPaymentApproval(
  tx: Prisma.TransactionClient,
  customerId: string,
  method: "CASH" | "ZELLE",
  totalCents: number,
) {
  manualPaymentMethod.parse(method);
  z.number().int().positive().max(1000000).parse(totalCents);
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
  const c = await customer(tx, customerId);
  const a = await tx.manualPaymentApproval.findUnique({
    where: { customerId_method: { customerId, method } },
  });
  if (
    !c.purchaseApprovedAt ||
    !c.user.emailVerified ||
    c.user.mustChangeCredentials ||
    !a?.enabled ||
    a.expiresAt <= new Date() ||
    totalCents > a.maxOrderCents
  )
    throw new AccountError(
      "A current staff approval covering this payment is required.",
      409,
    );
  return { approvalId: a.id, approvalVersion: a.version, method: a.method };
}
export type ManualPaymentApprovalsData = Awaited<
  ReturnType<typeof readManualPaymentApprovals>
>;
