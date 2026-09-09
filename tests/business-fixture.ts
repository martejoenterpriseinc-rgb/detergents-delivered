import "./integration-guard";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient, RoleCode, User } from "@prisma/client";
export const businessPassword = "Synthetic-Business-Owner-Password-123";
export async function clearBusinessFixture(db: PrismaClient) {
  await db.businessDocumentVersion.deleteMany();
  await db.businessDocument.deleteMany();
  await db.businessSetupRevision.deleteMany();
  await db.businessSetup.deleteMany();
  await db.businessAccess.deleteMany();
}
export async function businessFixture(db: PrismaClient) {
  await clearBusinessFixture(db);
  const marker = randomUUID();
  const users: User[] = [];
  for (const code of ["SUPER_ADMIN", "ADMIN", "CUSTOMER"] as RoleCode[]) {
    const role = await db.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    users.push(
      await db.user.create({
        data: {
          email: `business-${code.toLowerCase()}-${marker}@example.test`,
          name: "Synthetic Business Reviewer",
          passwordHash: await bcrypt.hash(businessPassword, 4),
          userRoles: { create: { roleId: role.id } },
        },
      }),
    );
  }
  return {
    owner: users[0],
    admin: users[1],
    customer: users[2],
    async cleanup() {
      await clearBusinessFixture(db);
      await db.auditLog.deleteMany({
        where: { actorUserId: { in: users.map((u) => u.id) } },
      });
      await db.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
      await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    },
  };
}
