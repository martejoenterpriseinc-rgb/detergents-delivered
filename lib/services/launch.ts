import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import {
  LAUNCH_KEY,
  defaultLaunch,
  launchSchema,
  capacitySchema,
  zonePostalCodes,
  cadenceDates,
  emptyLoad,
  addLoad,
  loadForItems,
  fitsVehicle,
} from "@/lib/domain/launch";
import { loyaltyAdmin } from "./loyalty";
import { createHash } from "node:crypto";

export async function launchConfig(db: Prisma.TransactionClient = prisma) {
  const row = await db.setting.findUnique({ where: { key: LAUNCH_KEY } });
  // Database failures and invalid stored rules must never become a permissive default.
  return row ? launchSchema.parse(row.valueJson) : defaultLaunch;
}
export async function getLaunchWorkspace(userId: string) {
  await loyaltyAdmin(prisma, userId);
  const [config, vehicles, zones] = await Promise.all([
    launchConfig(),
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.deliveryZone.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    config,
    vehicles: vehicles.map((v) => ({
      ...v,
      updatedAt: v.updatedAt.toISOString(),
      createdAt: v.createdAt.toISOString(),
    })),
    zones: zones.map((v) => ({
      id: v.id,
      name: v.name,
      postalCodes: zonePostalCodes(v.boundaryJson),
    })),
  };
}
export async function saveLaunch(userId: string, input: unknown) {
  const data = launchSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loyaltyAdmin(tx, userId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(613279105)`;
    await tx.setting.upsert({
      where: { key: LAUNCH_KEY },
      update: {},
      create: {
        key: LAUNCH_KEY,
        valueJson: defaultLaunch as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.$queryRaw`SELECT id FROM "Setting" WHERE key = ${LAUNCH_KEY} FOR UPDATE`;
    const before = await launchConfig(tx);
    if (data.version !== before.version)
      throw new AccountError("Settings changed. Refresh before saving.", 409);
    for (const old of before.cadences.filter((c) => c.locked)) {
      const next = data.cadences.find((c) => c.zoneId === old.zoneId);
      if (
        !next ||
        old.vehicleId !== next.vehicleId ||
        old.weekday !== next.weekday ||
        [...old.weeks].sort().join() !== [...next.weeks].sort().join()
      )
        throw new AccountError(
          "Unlock the saved area cadence in a separate save before changing its weeks, day or vehicle. Existing bookings remain unchanged.",
          409,
        );
    }
    for (const cadence of data.cadences) {
      const [zone, vehicle] = await Promise.all([
        tx.deliveryZone.findFirst({ where: { id: cadence.zoneId, isActive: true } }),
        tx.vehicle.findFirst({ where: { id: cadence.vehicleId, isActive: true } }),
      ]);
      if (
        !zone ||
        !zonePostalCodes(zone.boundaryJson).length ||
        !vehicle ||
        !capacitySchema.safeParse({
          capacityStops: vehicle.capacityStops,
          capacityUnits: vehicle.capacityUnits,
          detergentBucketLimit: vehicle.detergentBucketLimit,
          scentBeadBucketLimit: vehicle.scentBeadBucketLimit,
        }).success
      )
        throw new AccountError(
          "Every cadence requires an active zone with ZIP codes and a configured vehicle.",
        );
    }
    const saved = { ...data, version: data.version + 1 };
    await tx.setting.update({
      where: { key: LAUNCH_KEY },
      data: { valueJson: saved as unknown as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "launch.settings.saved",
        entityType: "Setting",
        entityId: LAUNCH_KEY,
        beforeJson: before as unknown as Prisma.InputJsonValue,
        afterJson: saved as unknown as Prisma.InputJsonValue,
      },
    });
    return saved;
  });
}
export async function saveVehicleCapacity(userId: string, input: unknown) {
  const data = capacitySchema
    .extend({ id: z.string().min(1).max(100), updatedAt: z.iso.datetime() })
    .parse(input);
  return prisma.$transaction(async (tx) => {
    await loyaltyAdmin(tx, userId);
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${data.id} FOR UPDATE`;
    const before = await tx.vehicle.findUnique({ where: { id: data.id } });
    if (!before?.isActive) throw new AccountError("Vehicle not found.", 404);
    if (before.updatedAt.toISOString() !== data.updatedAt)
      throw new AccountError("Vehicle settings changed. Refresh before saving.", 409);
    // Capacity edits cannot rewrite or invalidate existing paid route loads.
    const routes = await tx.route.count({
      where: {
        vehicleId: data.id,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        stops: { some: { completedAt: null } },
      },
    });
    if (
      routes &&
      (data.capacityStops < before.capacityStops ||
        data.capacityUnits < before.capacityUnits ||
        data.detergentBucketLimit < before.detergentBucketLimit ||
        data.scentBeadBucketLimit < before.scentBeadBucketLimit)
    )
      throw new AccountError(
        "This vehicle has booked deliveries. Resolve those routes before reducing capacity.",
        409,
      );
    const { id, updatedAt: _version, ...limits } = data;
    void _version;
    const saved = await tx.vehicle.update({ where: { id }, data: limits });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "vehicle.capacity.saved",
        entityType: "Vehicle",
        entityId: id,
        afterJson: limits,
      },
    });
    return saved;
  });
}
export async function saveZoneZips(userId: string, input: unknown) {
  const data = z
    .object({
      id: z.string().min(1).max(100),
      postalCodes: z
        .array(z.string().regex(/^\d{5}$/))
        .min(1)
        .max(500),
    })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    await loyaltyAdmin(tx, userId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(613279105)`;
    // Serializes cross-zone ZIP assignment checks; no address ownership inferred from ZIP.
    await tx.$queryRaw`SELECT id FROM "DeliveryZone" ORDER BY id FOR UPDATE`;
    const zones = await tx.deliveryZone.findMany({ where: { isActive: true } });
    const before = zones.find((zone) => zone.id === data.id);
    if (!before) throw new AccountError("Zone not found.", 404);
    if (
      zones.some(
        (zone) =>
          zone.id !== data.id &&
          zonePostalCodes(zone.boundaryJson).some((zip) =>
            data.postalCodes.includes(zip),
          ),
      )
    )
      throw new AccountError("A ZIP is already assigned to another active zone.", 409);
    const config = await launchConfig(tx);
    if (config.cadences.some((c) => c.zoneId === data.id && c.locked))
      throw new AccountError(
        "Unlock this area's cadence before editing its ZIP codes.",
        409,
      );
    const polygon =
      before.boundaryJson &&
      typeof before.boundaryJson === "object" &&
      !Array.isArray(before.boundaryJson)
        ? before.boundaryJson
        : {};
    await tx.deliveryZone.update({
      where: { id: data.id },
      data: { boundaryJson: { ...polygon, postalCodes: [...new Set(data.postalCodes)] } },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "zone.zips.saved",
        entityType: "DeliveryZone",
        entityId: data.id,
        afterJson: data,
      },
    });
    return { ok: true };
  });
}
export async function createLaunchResource(userId: string, input: unknown) {
  const shared = { requestKey: z.uuid(), name: z.string().trim().min(1).max(100) };
  const data = z
    .discriminatedUnion("type", [
      z
        .object({
          ...shared,
          type: z.literal("zone"),
          postalCodes: z
            .array(z.string().regex(/^\d{5}$/))
            .min(1)
            .max(500),
        })
        .strict(),
      capacitySchema.extend({ ...shared, type: z.literal("vehicle") }).strict(),
    ])
    .parse(input);
  return prisma.$transaction(async (tx) => {
    await loyaltyAdmin(tx, userId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(613279105)`;
    const id = `launch-${data.requestKey}`;
    const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    const existing = await tx.auditLog.findFirst({
      where: { action: "launch.resource.created", entityId: id },
    });
    if (existing) {
      if (
        existing.actorUserId !== userId ||
        (existing.afterJson as { hash: string }).hash !== hash
      )
        throw new AccountError("This request was used for different settings.", 409);
      return { id };
    }
    if (data.type === "zone") {
      const zones = await tx.deliveryZone.findMany({ where: { isActive: true } });
      if (
        zones.some((zone) =>
          zonePostalCodes(zone.boundaryJson).some((zip) =>
            data.postalCodes.includes(zip),
          ),
        )
      )
        throw new AccountError("A ZIP is already assigned to an active zone.", 409);
      await tx.deliveryZone.create({
        data: {
          id,
          name: data.name,
          slug: id,
          boundaryJson: { postalCodes: [...new Set(data.postalCodes)] },
        },
      });
    } else {
      await tx.vehicle.create({
        data: {
          id,
          name: data.name,
          capacityStops: data.capacityStops,
          capacityUnits: data.capacityUnits,
          detergentBucketLimit: data.detergentBucketLimit,
          scentBeadBucketLimit: data.scentBeadBucketLimit,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "launch.resource.created",
        entityType: data.type,
        entityId: id,
        afterJson: { hash },
      },
    });
    return { id };
  });
}
export async function launchDemand(userId: string) {
  const workspace = await getLaunchWorkspace(userId);
  const cutoff = new Date(`${workspace.config.cutoffDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 2); // broad SQL range; exact Chicago cutoff below
  const orders = await prisma.order.findMany({
    where: {
      customer: { deletedAt: null, user: { deletedAt: null } },
      status: { in: ["PAID", "FULFILLING"] },
      currency: "USD",
      placedAt: { lt: cutoff },
      routeStops: { none: { route: { status: { not: "CANCELLED" } } } },
    },
    include: {
      customer: { select: { firstName: true, lastName: true } },
      address: true,
      items: { include: { productVariant: { include: { product: true } } } },
    },
    orderBy: [{ placedAt: "asc" }, { id: "asc" }],
    take: 5001,
  });
  if (orders.length > 5000)
    throw new AccountError("Demand exceeds this planning view's 5,000-order limit.", 409);
  const loads = new Map<string, ReturnType<typeof emptyLoad>>();
  const unavailableDays = new Set<string>();
  const existingRoutes = await prisma.route.findMany({
    where: {
      status: { in: ["DRAFT", "SCHEDULED", "IN_PROGRESS"] },
      serviceDate: {
        gte: new Date(workspace.config.launchDate),
        lte: new Date(workspace.config.firstDeliveryBy),
      },
      vehicleId: { in: workspace.vehicles.map((v) => v.id) },
    },
    include: {
      stops: {
        include: {
          order: {
            include: {
              items: { include: { productVariant: { include: { product: true } } } },
            },
          },
        },
      },
    },
  });
  for (const route of existingRoutes) {
    const key = `${route.vehicleId}:${route.serviceDate.toISOString().slice(0, 10)}`;
    for (const stop of route.stops) {
      try {
        if (!stop.order?.items.length) throw new Error("Unknown reserved load");
        const load = loadForItems(
          stop.order.items.map((item) => ({
            quantity: item.quantity,
            units:
              item.productVariant.deliveryCapacityUnits ??
              item.productVariant.product.deliveryCapacityUnits,
            kind: item.productVariant.product.loadKind,
          })),
        );
        loads.set(key, addLoad(loads.get(key) ?? emptyLoad(), load));
      } catch {
        unavailableDays.add(key);
      }
    }
  }
  const rows = orders
    .filter((o) => o.placedAt && businessDate(o.placedAt) <= workspace.config.cutoffDate)
    .map((order) => {
      const address = order.address;
      const zone = workspace.zones.find(
        (z) =>
          z.id === address?.deliveryZoneId &&
          z.postalCodes.includes(address?.postalCode ?? ""),
      );
      const cadence = workspace.config.cadences.find((c) => c.zoneId === zone?.id);
      const vehicle = workspace.vehicles.find((v) => v.id === cadence?.vehicleId);
      let proposedDate: string | null = null;
      let reason = "Zone, address validation or locked cadence needs review";
      if (
        address?.customerId === order.customerId &&
        address.validatedAt &&
        address.validationSource &&
        address.country === "US" &&
        !address.deletedAt &&
        cadence?.locked &&
        vehicle &&
        workspace.config.enabled
      ) {
        try {
          if (!order.items.length) throw new Error("Missing order items");
          const load = loadForItems(
            order.items.map((item) => ({
              quantity: item.quantity,
              units:
                item.productVariant.deliveryCapacityUnits ??
                item.productVariant.product.deliveryCapacityUnits,
              kind: item.productVariant.product.loadKind,
            })),
          );
          for (const date of cadenceDates(
            cadence,
            workspace.config.launchDate,
            workspace.config.firstDeliveryBy,
          )) {
            const key = `${vehicle.id}:${date}`;
            if (unavailableDays.has(key)) continue;
            const next = addLoad(loads.get(key) ?? emptyLoad(), load);
            if (
              fitsVehicle(
                {
                  capacityStops: vehicle.capacityStops,
                  capacityUnits: vehicle.capacityUnits,
                  detergentBucketLimit: vehicle.detergentBucketLimit,
                  scentBeadBucketLimit: vehicle.scentBeadBucketLimit,
                },
                next,
              )
            ) {
              loads.set(key, next);
              proposedDate = date;
              break;
            }
          }
          reason = proposedDate
            ? "Draft only — includes current booked loads; not a reservation"
            : "No capacity within the launch window";
        } catch {
          reason = "Product load or vehicle capacity needs configuration";
        }
      }
      return {
        id: order.id,
        number: order.number,
        customer: [order.customer.firstName, order.customer.lastName]
          .filter(Boolean)
          .join(" "),
        city: address?.city ?? "Unknown",
        postalCode: address?.postalCode ?? "Unknown",
        zone: zone?.name ?? "Unassigned",
        proposedDate,
        reason,
      };
    });
  return { ...workspace, rows };
}
