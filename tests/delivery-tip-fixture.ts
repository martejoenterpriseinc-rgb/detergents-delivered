import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { receiptFixture } from "./customer-receipt-fixture";
export async function deliveryTipFixture(db: PrismaClient, passwordHash?: string) {
  const f = await receiptFixture(db, { financialEvidence: true, passwordHash });
  const user = await db.user.update({
    where: { id: f.userId },
    data: { emailVerified: new Date() },
    include: { customer: true },
  });
  const role = await db.role.upsert({
    where: { code: "DRIVER" },
    create: { code: "DRIVER", name: "Driver" },
    update: {},
  });
  const driver = await db.user.create({
    data: {
      email: `tip-driver-${randomUUID()}@example.test`,
      userRoles: { create: { roleId: role.id } },
    },
  });
  const address = await db.address.create({
    data: {
      customerId: user.customer!.id,
      line1: "1 Synthetic Street",
      line2: "Unit 2",
      city: "Synthetic",
      region: "IL",
      postalCode: "60000",
    },
  });
  await db.order.update({ where: { id: f.orderId }, data: { addressId: address.id } });
  const route = await db.route.create({
    data: {
      number: `TIP-${randomUUID()}`,
      status: "COMPLETED",
      serviceDate: new Date("2000-01-01T00:00:00Z"),
      stops: {
        create: {
          sequence: 1,
          addressId: address.id,
          orderId: f.orderId,
          driverUserId: driver.id,
          completedAt: new Date(),
        },
      },
    },
    include: { stops: true },
  });
  const attempt = await db.deliveryAttempt.create({
    data: {
      orderId: f.orderId,
      routeStopId: route.stops[0].id,
      addressId: address.id,
      driverUserId: driver.id,
      result: "DELIVERED",
      photos: { create: { storageKey: `synthetic-tip-${randomUUID()}` } },
    },
  });
  return {
    ...f,
    driver,
    attempt,
    cleanup: () =>
      db.user.updateMany({
        where: { id: { in: [f.userId, driver.id] } },
        data: { deletedAt: new Date() },
      }),
  };
}
