import { randomUUID } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
export async function manualPaymentFixture(db: PrismaClient, passwordHash?: string) {
  const users: User[] = [];
  for (const code of ["ADMIN", "CPA", "CUSTOMER", "DRIVER"] as const) {
    const role = await db.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    users.push(
      await db.user.create({
        data: {
          email: `manual-${code.toLowerCase()}-${randomUUID()}@example.test`,
          emailVerified: new Date(),
          passwordHash,
          userRoles: { create: { roleId: role.id } },
        },
      }),
    );
  }
  const [admin, cpa, buyer, driver] = users;
  const customer = await db.customer.create({
    data: {
      userId: buyer.id,
      firstName: "Payment",
      lastName: "Approval Test",
      purchaseApprovedAt: new Date(),
    },
  });
  return {
    admin,
    cpa,
    buyer,
    driver,
    customer,
    cleanup: () =>
      db.user.updateMany({
        where: { id: { in: users.map((u) => u.id) } },
        data: { deletedAt: new Date() },
      }),
  };
}
