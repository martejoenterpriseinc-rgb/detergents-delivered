import type { Prisma } from "@prisma/client";

export async function writeAuditLog(
  db: Prisma.TransactionClient | typeof import("@/lib/prisma").prisma,
  input: {
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    beforeJson?: Prisma.InputJsonValue;
    afterJson?: Prisma.InputJsonValue;
  },
) {
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? undefined,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: input.beforeJson,
      afterJson: input.afterJson,
    },
  });
}
