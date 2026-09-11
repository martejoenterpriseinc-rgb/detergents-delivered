import type { Prisma } from "@prisma/client";
export async function revokeCustomerSms(
  tx: Prisma.TransactionClient,
  customerId: string,
) {
  await tx.smsConsent.updateMany({
    where: { customerId, state: { not: "REVOKED" } },
    data: { state: "REVOKED", revokedAt: new Date() },
  });
}
