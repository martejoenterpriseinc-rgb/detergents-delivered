import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { operationsFixture } from "@/tests/operations-fixture";
import {
  customerDirectory,
  editOperationsCustomer,
  createCustomerInvite,
  countedRevenue,
  dailyQueue,
} from "./operations";
import { deliveryAction, completeWithPhoto, ownedProof } from "./delivery-operations";
import { getDeliveryWidget } from "./delivery-widget";
import { getCustomerOrders } from "./customer-account";
const action = (
  routeId: string,
  kind: "begin" | "navigate" | "arrive",
  stopId?: string,
) => ({ routeId, action: kind, stopId, requestKey: randomUUID() });
describe("operations native PostgreSQL", () => {
  it("protects customer lists, concurrent profile saves, invitations and integer revenue", async () => {
    const f = await operationsFixture(prisma);
    try {
      await expect(customerDirectory(f.customers[0].id)).rejects.toMatchObject({
        status: 403,
      });
      await expect(customerDirectory(f.driver.id)).rejects.toMatchObject({ status: 403 });
      const directory = await customerDirectory(f.admin.id, {
        group: "referred",
        q: f.marker,
      });
      expect(directory.rows).toHaveLength(3);
      expect(directory.rows.every((c) => c.referrer === "Sarah Mitchell")).toBe(true);
      const c = await prisma.customer.findUniqueOrThrow({
        where: { id: f.customers[0].customer!.id },
      });
      const input = {
        id: c.id,
        updatedAt: c.updatedAt.toISOString(),
        firstName: "Sarah",
        lastName: "Updated",
        phone: "+15555550101",
      };
      const saves = await Promise.allSettled([
        editOperationsCustomer(f.admin.id, input),
        editOperationsCustomer(f.admin.id, input),
      ]);
      expect(saves.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).lastName,
      ).toBe("Updated");
      const invite = {
        email: `invite-${f.marker}@example.test`,
        firstName: "New",
        requestKey: randomUUID(),
      };
      const both = await Promise.all([
        createCustomerInvite(f.admin.id, invite),
        createCustomerInvite(f.admin.id, invite),
      ]);
      expect(both[0]).toEqual(both[1]);
      expect(
        await prisma.customerInvite.count({ where: { requestKey: invite.requestKey } }),
      ).toBe(1);
      expect(both[0].status).toBe("CREATED");
      await expect(
        createCustomerInvite(f.admin.id, { ...invite, email: f.customers[0].email }),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        countedRevenue({
          totalCents: 4384,
          refunds: [{ amountCents: 384 }, { amountCents: 1000 }],
        }),
      ).toBe(3000);
    } finally {
      await f.cleanup();
    }
  });
  it("enforces driver assignment, route sequence, retry idempotency, failed photo recovery and customer isolation", async () => {
    process.env.DD_LOCAL_PROOF_STORAGE = "true";
    const f = await operationsFixture(prisma);
    try {
      const [first, second] = f.route.stops;
      await expect(
        deliveryAction(f.stranger.id, action(f.route.id, "begin")),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        deliveryAction(f.customers[0].id, action(f.route.id, "begin")),
      ).rejects.toMatchObject({ status: 403 });
      const begin = action(f.route.id, "begin");
      await Promise.all([
        deliveryAction(f.driver.id, begin),
        deliveryAction(f.driver.id, begin),
      ]);
      expect(
        await prisma.deliveryAction.count({ where: { requestKey: begin.requestKey } }),
      ).toBe(1);
      expect(await prisma.routeLeg.count({ where: { routeId: f.route.id } })).toBe(7);
      expect((await getDeliveryWidget(f.customers[0].id)).status).toBe("TODAY");
      await expect(
        deliveryAction(f.driver.id, action(f.route.id, "navigate", second.id)),
      ).rejects.toMatchObject({ status: 409 });
      const nav = action(f.route.id, "navigate", first.id);
      const raced = await Promise.allSettled([
        deliveryAction(f.driver.id, nav),
        deliveryAction(f.driver.id, action(f.route.id, "navigate", first.id)),
      ]);
      expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await getDeliveryWidget(f.customers[0].id)).status).toBe("EN_ROUTE");
      await deliveryAction(f.driver.id, action(f.route.id, "arrive", first.id));
      const key = randomUUID();
      await expect(
        completeWithPhoto(
          f.driver.id,
          f.route.id,
          first.id,
          key,
          Buffer.from("invalid image contents"),
        ),
      ).rejects.toMatchObject({ status: 415 });
      expect(
        (await prisma.routeStop.findUniqueOrThrow({ where: { id: first.id } }))
          .completedAt,
      ).toBeNull();
      expect(
        await prisma.deliveryAttempt.count({ where: { routeStopId: first.id } }),
      ).toBe(0);
      const image = await sharp({
        create: { width: 80, height: 60, channels: 3, background: "#24755d" },
      })
        .jpeg()
        .toBuffer();
      process.env.DD_LOCAL_PROOF_STORAGE = "false";
      process.env.DD_OPERATING_MEDIA_ENABLED = "false";
      await expect(
        completeWithPhoto(f.driver.id, f.route.id, first.id, key, image),
      ).rejects.toMatchObject({ status: 503 });
      process.env.DD_LOCAL_PROOF_STORAGE = "true";
      process.env.DD_OPERATING_MEDIA_ENABLED = "true";
      await Promise.all([
        completeWithPhoto(f.driver.id, f.route.id, first.id, key, image),
        completeWithPhoto(f.driver.id, f.route.id, first.id, key, image),
      ]);
      expect(
        await prisma.deliveryAttempt.count({ where: { routeStopId: first.id } }),
      ).toBe(1);
      const photo = await prisma.deliveryPhoto.findFirstOrThrow({
        where: { deliveryAttempt: { routeStopId: first.id } },
      });
      expect((await ownedProof(f.customers[0].id, photo.id)).length).toBeGreaterThan(0);
      await expect(ownedProof(f.customers[1].id, photo.id)).rejects.toMatchObject({
        status: 404,
      });
      expect((await getDeliveryWidget(f.customers[0].id)).status).toBe("DELIVERED");
      expect(
        (await getCustomerOrders(f.customers[0].id))[0].routeStops[0].deliveryAttempts[0]
          .photos[0].id,
      ).toBe(photo.id);
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: first.orderId! } }))
          .totalCents,
      ).toBe(f.orders[0].totalCents);
      expect((await dailyQueue(f.driver.id)).completed).toBe(1);
      // A started route survives a date rollover and records another stop without restarting.
      await prisma.route.update({
        where: { id: f.route.id },
        data: { serviceDate: new Date("2026-01-01") },
      });
      await deliveryAction(f.driver.id, action(f.route.id, "navigate", second.id));
      await completeWithPhoto(f.driver.id, f.route.id, first.id, key, image);
      expect(
        (await prisma.routeStop.findUniqueOrThrow({ where: { id: second.id } }))
          .startedAt,
      ).not.toBeNull();
    } finally {
      process.env.DD_LOCAL_PROOF_STORAGE = "true";
      await f.cleanup();
    }
  });
  it("blocks unpaid stops and duplicate active bookings without changing historical money", async () => {
    process.env.DD_LOCAL_PROOF_STORAGE = "true";
    const f = await operationsFixture(prisma);
    try {
      const first = f.route.stops[0];
      await prisma.order.update({
        where: { id: first.orderId! },
        data: { status: "PENDING_PAYMENT" },
      });
      await expect(
        deliveryAction(f.admin.id, action(f.route.id, "begin")),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await prisma.route.findUniqueOrThrow({ where: { id: f.route.id } })).status,
      ).toBe("SCHEDULED");
      await prisma.order.update({
        where: { id: first.orderId! },
        data: { status: "PAID" },
      });
      await prisma.routeStop.create({
        data: {
          routeId: f.route.id,
          sequence: 9,
          orderId: first.orderId,
          addressId: first.addressId,
          driverUserId: f.driver.id,
        },
      });
      await expect(
        deliveryAction(f.admin.id, action(f.route.id, "begin")),
      ).rejects.toMatchObject({ status: 409 });
      expect(await prisma.routeLeg.count({ where: { routeId: f.route.id } })).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
});
