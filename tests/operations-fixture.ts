import "./integration-guard";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient, RoleCode } from "@prisma/client";
import { businessDate } from "../lib/domain/operations";
export const operationsPassword = "Synthetic-Operations-Password-123";
export async function operationsFixture(db: PrismaClient) {
  const marker = randomUUID();
  const ids: string[] = [];
  const roles = await Promise.all(
    (["CUSTOMER", "ADMIN", "DRIVER"] as RoleCode[]).map((code) =>
      db.role.upsert({ where: { code }, update: {}, create: { code, name: code } }),
    ),
  );
  async function person(name: string, role: RoleCode = "CUSTOMER", index = 0) {
    const u = await db.user.create({
      data: {
        name,
        email: `${name.split(" ")[0].toLowerCase()}-${marker}@example.test`,
        emailVerified: new Date(),
        passwordHash: await bcrypt.hash(operationsPassword, 4),
        userRoles: { create: { roleId: roles.find((r) => r.code === role)!.id } },
        ...(role === "CUSTOMER"
          ? {
              customer: {
                create: {
                  firstName: name.split(" ")[0],
                  lastName: name.split(" ").slice(1).join(" "),
                  phone: "+15555550100",
                  addresses: {
                    create: {
                      line1: `${100 + index} Synthetic Lane`,
                      city: ["Algonquin", "Lake in the Hills", "Crystal Lake", "Cary"][
                        index % 4
                      ],
                      region: "IL",
                      postalCode: "60102",
                      isDefault: true,
                      lat: [42.165, 42.181, 42.218, 42.205, 42.145, 42.19][index % 6],
                      lng: [-88.294, -88.33, -88.321, -88.245, -88.279, -88.289][
                        index % 6
                      ],
                    },
                  },
                },
              },
            }
          : {}),
      },
      include: { customer: { include: { addresses: true } } },
    });
    ids.push(u.id);
    return u;
  }
  const admin = await person("Operations Owner", "ADMIN");
  const driver = await person("Assigned Driver", "DRIVER");
  const stranger = await person("Other Driver", "DRIVER");
  const names = [
    "Sarah Mitchell",
    "James Wilson",
    "Emily Thompson",
    "Michael Davis",
    "Olivia Bennett",
    "Daniel Brooks",
  ];
  const customers = [];
  for (let i = 0; i < names.length; i++)
    customers.push(await person(names[i], "CUSTOMER", i));
  for (const i of [1, 3, 5])
    await db.referral.create({
      data: {
        referrerId: customers[0].customer!.id,
        refereeId: customers[i].customer!.id,
        code: `SYNTHETIC-${marker}-${i}`,
      },
    });
  const product = await db.product.create({
    data: {
      name: "Fresh Linen detergent",
      brand: "Detergents Delivered",
      slug: `operations-${marker}`,
      variants: { create: { name: "5 gallon bucket", sku: `OPS-${marker}` } },
    },
    include: { variants: true },
  });
  const orders = [];
  for (let i = 0; i < customers.length; i++) {
    const c = customers[i].customer!;
    orders.push(
      await db.order.create({
        data: {
          number: `DD-${1001 + i}-${marker.slice(0, 4)}`,
          customerId: c.id,
          addressId: c.addresses[0].id,
          status: "PAID",
          subtotalCents: 3500 + i * 500,
          taxCents: 280 + i * 40,
          totalCents: 3780 + i * 540,
          placedAt: new Date(),
          items: {
            create: {
              productVariantId: product.variants[0].id,
              nameSnapshot: "Fresh Linen · 5 gallon",
              skuSnapshot: product.variants[0].sku,
              quantity: 1,
              unitPriceCents: 3500 + i * 500,
              taxCents: 280 + i * 40,
              lineTotalCents: 3780 + i * 540,
            },
          },
        },
      }),
    );
  }
  const route = await db.route.create({
    data: {
      number: `NORTH-${marker}`,
      serviceDate: new Date(businessDate()),
      status: "SCHEDULED",
      plannedMiles: 28.4,
      stops: {
        create: orders.map((o, i) => ({
          orderId: o.id,
          addressId: o.addressId!,
          sequence: i + 1,
          driverUserId: driver.id,
          plannedArriveAt: new Date(
            `${businessDate()}T${String(15 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}:00Z`,
          ),
        })),
      },
    },
    include: { stops: { orderBy: { sequence: "asc" } } },
  });
  return {
    marker,
    admin,
    driver,
    stranger,
    customers,
    orders,
    route,
    async cleanup() {
      await db.route.update({ where: { id: route.id }, data: { status: "CANCELLED" } });
      await db.user.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date() },
      });
    },
  };
}
