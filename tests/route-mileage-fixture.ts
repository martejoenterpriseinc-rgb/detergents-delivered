import { randomUUID } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import { businessDate } from "../lib/domain/operations";
export async function mileageFixture(db: PrismaClient, passwordHash?: string) {
  const marker = randomUUID();
  const users: User[] = [];
  for (const code of ["ADMIN", "DRIVER", "CPA", "CUSTOMER", "DRIVER"] as const) {
    const role = await db.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    users.push(
      await db.user.create({
        data: {
          email: `mileage-${code.toLowerCase()}-${users.length}-${marker}@example.test`,
          passwordHash,
          userRoles: { create: { roleId: role.id } },
        },
      }),
    );
  }
  const [admin, driver, cpa, outsider, stranger] = users;
  const customer = await db.customer.create({ data: { userId: outsider.id } });
  const address = await db.address.create({
    data: {
      customerId: customer.id,
      line1: "1 Synthetic Street",
      city: "Synthetic",
      region: "IL",
      postalCode: "60000",
    },
  });
  const vehicle = await db.vehicle.create({
    data: { name: "Synthetic mileage vehicle " + marker },
  });
  const route = await db.route.create({
    data: {
      number: "MILES-" + marker,
      vehicleId: vehicle.id,
      status: "COMPLETED",
      serviceDate: new Date(businessDate() + "T00:00:00Z"),
      stops: {
        create: [1, 2].map((sequence) => ({
          sequence,
          addressId: address.id,
          driverUserId: driver.id,
          arrivedAt: new Date(),
          completedAt: new Date(),
        })),
      },
    },
    include: { stops: true },
  });
  return {
    admin,
    driver,
    cpa,
    outsider,
    stranger,
    route,
    vehicle,
    cleanup: async () => {
      await db.route.update({
        where: { id: route.id },
        data: { serviceDate: new Date("2000-01-01T00:00:00Z") },
      });
      await db.user.updateMany({
        where: { id: { in: users.map((u) => u.id) } },
        data: { deletedAt: new Date() },
      });
      await db.vehicle.update({ where: { id: vehicle.id }, data: { isActive: false } });
    },
  };
}
