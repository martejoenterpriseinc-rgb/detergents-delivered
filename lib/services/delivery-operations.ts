import { z } from "zod";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate, deliveryActionSchema } from "@/lib/domain/operations";
import { operationsStaff, paidStatuses } from "./operations";
import { loadProof, proofStorageReady, saveProof } from "./proof-storage";
import { accountIdentity } from "./customer-account";

async function lockedRoute(tx: Prisma.TransactionClient, actor: string, routeId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor} FOR UPDATE`;
  const { isAdmin } = await operationsStaff(tx, actor, true);
  await tx.$queryRaw`SELECT id FROM "Route" WHERE id=${routeId} FOR UPDATE`;
  const route = await tx.route.findUnique({
    where: { id: routeId },
    include: {
      stops: { orderBy: { sequence: "asc" }, include: { address: true, order: true } },
    },
  });
  if (!route || (!isAdmin && route.stops.some((s) => s.driverUserId !== actor)))
    throw new AccountError("Route not found or not assigned to you.", 403);
  return route;
}
async function assertPaidStops(
  tx: Prisma.TransactionClient,
  route: Awaited<ReturnType<typeof lockedRoute>>,
) {
  for (const s of route.stops
    .filter((s) => !s.completedAt)
    .sort((a, b) => (a.orderId ?? "").localeCompare(b.orderId ?? ""))) {
    if (!s.orderId) throw new AccountError("Every stop needs a paid order.", 409);
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${s.orderId} FOR UPDATE`;
    const o = await tx.order.findUniqueOrThrow({ where: { id: s.orderId } });
    if (
      !paidStatuses.includes(o.status as (typeof paidStatuses)[number]) ||
      o.status === "DELIVERED" ||
      o.customerId !== s.address.customerId ||
      o.addressId !== s.addressId ||
      s.address.deletedAt
    )
      throw new AccountError("A stop's payment or address needs review.", 409);
    if (
      (await tx.routeStop.count({
        where: {
          orderId: o.id,
          completedAt: null,
          route: { status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
        },
      })) > 1
    )
      throw new AccountError(
        "An order is booked on more than one active stop. Review before delivery.",
        409,
      );
  }
}
const digest = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
export async function deliveryAction(actor: string, input: unknown) {
  const d = deliveryActionSchema.parse(input);
  const hash = digest({ ...d, actor });
  return prisma.$transaction(
    async (tx) => {
      const route = await lockedRoute(tx, actor, d.routeId);
      const previous = await tx.deliveryAction.findUnique({
        where: { requestKey: d.requestKey },
      });
      if (previous) {
        if (previous.requestHash !== hash)
          throw new AccountError("Request was already used for another action.", 409);
        return { ok: true };
      }
      if (
        route.status !== "IN_PROGRESS" &&
        route.serviceDate.toISOString().slice(0, 10) !== businessDate()
      )
        throw new AccountError(
          "Only today’s scheduled routes can begin. Started routes can resume.",
          409,
        );
      if (!proofStorageReady())
        throw new AccountError(
          "Connect private proof-photo storage before starting a delivery route.",
          503,
        );
      if (!["SCHEDULED", "IN_PROGRESS"].includes(route.status) || !route.stops.length)
        throw new AccountError("This route is not ready to start.", 409);
      await assertPaidStops(tx, route);
      const next = route.stops.find((s) => !s.completedAt);
      if (d.action === "begin") {
        if (route.status !== "SCHEDULED")
          throw new AccountError(
            "This route has already started. Continue its next stop.",
            409,
          );
        if (route.stops.some((s) => s.completedAt))
          throw new AccountError(
            "A partly completed route needs review before restarting.",
            409,
          );
        await tx.route.update({
          where: { id: route.id },
          data: { status: "IN_PROGRESS" },
        });
        for (const s of route.stops)
          await tx.routeLeg.upsert({
            where: { routeId_sequence: { routeId: route.id, sequence: s.sequence } },
            update: {},
            create: {
              routeId: route.id,
              sequence: s.sequence,
              fromStopId:
                route.stops.filter((p) => p.sequence < s.sequence).at(-1)?.id ?? null,
              toStopId: s.id,
              source: "Saved stop order; distance not measured",
            },
          });
        const last = route.stops.at(-1)!;
        await tx.routeLeg.upsert({
          where: { routeId_sequence: { routeId: route.id, sequence: last.sequence + 1 } },
          update: {},
          create: {
            routeId: route.id,
            sequence: last.sequence + 1,
            fromStopId: last.id,
            source: "Return to origin; distance not measured",
          },
        });
      } else {
        if (route.status !== "IN_PROGRESS" || !next || d.stopId !== next.id)
          throw new AccountError(
            "Complete the previous stop before starting this one.",
            409,
          );
        if (d.action === "navigate") {
          if (next.startedAt)
            throw new AccountError("This stop is already in progress.", 409);
          if (
            await tx.routeStop.findFirst({
              where: {
                driverUserId: actor,
                startedAt: { not: null },
                completedAt: null,
                id: { not: next.id },
              },
            })
          )
            throw new AccountError("Finish your active stop first.", 409);
          await tx.routeStop.update({
            where: { id: next.id },
            data: { startedAt: new Date(), driverUserId: actor },
          });
          await tx.order.update({
            where: { id: next.orderId! },
            data: { status: "OUT_FOR_DELIVERY" },
          });
        } else {
          if (!next.startedAt || next.arrivedAt)
            throw new AccountError("Start this stop before recording arrival.", 409);
          await tx.routeStop.update({
            where: { id: next.id },
            data: { arrivedAt: new Date() },
          });
        }
      }
      await tx.deliveryAction.create({
        data: { ...d, actorUserId: actor, requestHash: hash },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor,
          action: `delivery.${d.action}`,
          entityType: "Route",
          entityId: route.id,
          afterJson: { stopId: d.stopId ?? null },
        },
      });
      return { ok: true };
    },
    { timeout: 15000 },
  );
}
export async function completeWithPhoto(
  actor: string,
  routeId: string,
  stopId: string,
  requestKey: string,
  bytes: Buffer,
) {
  z.uuid().parse(requestKey);
  z.string().min(1).max(100).parse(routeId);
  z.string().min(1).max(100).parse(stopId);
  const hash = digest({
    actor,
    routeId,
    stopId,
    photo: createHash("sha256").update(bytes).digest("hex"),
  });
  return prisma.$transaction(
    async (tx) => {
      const route = await lockedRoute(tx, actor, routeId);
      const previous = await tx.deliveryAction.findUnique({ where: { requestKey } });
      if (previous) {
        if (previous.requestHash !== hash)
          throw new AccountError("Request was already used for another photo.", 409);
        return { ok: true };
      }
      const stop = route.stops.find((s) => !s.completedAt);
      if (
        route.status !== "IN_PROGRESS" ||
        !stop ||
        stop.id !== stopId ||
        !stop.arrivedAt
      )
        throw new AccountError(
          "Record arrival at the active stop before completing it.",
          409,
        );
      await assertPaidStops(tx, route);
      const photo = await saveProof(bytes, tx); // Bytes, delivery and audit commit together.
      const now = new Date();
      await tx.deliveryAttempt.create({
        data: {
          orderId: stop.orderId!,
          routeStopId: stop.id,
          addressId: stop.addressId,
          driverUserId: actor,
          result: "DELIVERED",
          photos: { create: { storageKey: photo.storageKey } },
        },
      });
      await tx.routeStop.update({ where: { id: stop.id }, data: { completedAt: now } });
      await tx.order.update({
        where: { id: stop.orderId! },
        data: { status: "DELIVERED" },
      });
      if (route.stops.every((s) => s.id === stop.id || s.completedAt))
        await tx.route.update({ where: { id: route.id }, data: { status: "COMPLETED" } });
      await tx.deliveryAction.create({
        data: {
          actorUserId: actor,
          routeId,
          stopId,
          requestKey,
          requestHash: hash,
          action: "complete",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor,
          action: "delivery.completed",
          entityType: "RouteStop",
          entityId: stop.id,
          afterJson: { photoHash: photo.hash },
        },
      });
      return { ok: true };
    },
    { timeout: 15000 },
  );
}
export async function ownedProof(userId: string, photoId: string) {
  const u = await accountIdentity(prisma, userId);
  const photo = await prisma.deliveryPhoto.findUnique({
    where: { id: photoId },
    include: {
      deliveryAttempt: { include: { order: { select: { customerId: true } } } },
    },
  });
  const isAdmin = u.userRoles.some((r) => ["ADMIN", "SUPER_ADMIN"].includes(r.role.code));
  const own =
    photo &&
    u.customer &&
    !u.customer.deletedAt &&
    photo.deliveryAttempt.order.customerId === u.customer.id;
  const driver =
    photo &&
    u.userRoles.some((r) => r.role.code === "DRIVER") &&
    photo.deliveryAttempt.driverUserId === u.id;
  if (!photo || (!isAdmin && !own && !driver))
    throw new AccountError("Photo not found.", 404);
  return loadProof(photo.storageKey);
}
