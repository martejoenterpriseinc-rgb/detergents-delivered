import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { businessDate } from "@/lib/domain/operations";
import { hundredths, routeMileageInput } from "@/lib/domain/route-mileage";
import { canonicalJson } from "@/lib/commerce/domain";
import { accountIdentity } from "./customer-account";
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
async function routeAccess(
  tx: Prisma.TransactionClient,
  actor: string,
  routeId: string,
  write = false,
) {
  const user = await accountIdentity(tx, actor);
  const codes = user.userRoles.map((r) => r.role.code);
  const admin = codes.some((c) => ["ADMIN", "SUPER_ADMIN"].includes(c));
  const cpa = codes.includes("CPA");
  if (!admin && !(cpa && !write) && !codes.includes("DRIVER"))
    throw new AccountError("Route mileage access required.", 403);
  const route = await tx.route.findUnique({
    where: { id: routeId },
    include: {
      vehicle: true,
      stops: { orderBy: { sequence: "asc" }, take: 101 },
      legs: { orderBy: { sequence: "asc" }, include: { mileageTrip: true }, take: 102 },
    },
  });
  if (
    !route ||
    (!admin &&
      !cpa &&
      (!route.stops.length || route.stops.some((s) => s.driverUserId !== actor)))
  )
    throw new AccountError("Route not found or not assigned to you.", 403);
  if (!route.stops.length || route.stops.length > 100)
    throw new AccountError(
      "Mileage supports routes with 1–100 stops. Review this route before saving.",
      422,
    );
  if (!route.vehicle || !["SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(route.status))
    throw new AccountError(
      "A scheduled, started or completed route with a vehicle is required.",
      409,
    );
  if (write && !admin && cpa) throw new AccountError("CPA access is read-only.", 403);
  const expected: {
    sequence: number;
    fromStopId: string | null;
    toStopId: string | null;
  }[] = route.stops.map((s, i) => ({
    sequence: s.sequence,
    fromStopId: route.stops[i - 1]?.id ?? null,
    toStopId: s.id,
  }));
  expected.push({
    sequence: route.stops.at(-1)!.sequence + 1,
    fromStopId: route.stops.at(-1)!.id,
    toStopId: null,
  });
  if (
    route.legs.some(
      (l) =>
        !expected.some(
          (e) =>
            e.sequence === l.sequence &&
            e.fromStopId === l.fromStopId &&
            e.toStopId === l.toStopId,
        ),
    )
  )
    throw new AccountError(
      "Saved route legs differ from the stop order. Review before recording mileage.",
      409,
    );
  return { route, expected, canWrite: admin || (!cpa && codes.includes("DRIVER")) };
}
export async function readRouteMileage(actor: string, routeId: string) {
  return prisma.$transaction(
    async (tx) => {
      const { route: r, expected, canWrite } = await routeAccess(tx, actor, routeId);
      return {
        id: r.id,
        number: r.number,
        date: r.serviceDate.toISOString().slice(0, 10),
        vehicle: r.vehicle!.name,
        version: r.mileageVersion,
        canWrite,
        actual: r.actualMiles?.toFixed(2) ?? null,
        planned: r.plannedMiles?.toFixed(2) ?? null,
        legs: expected.map((e, i) => {
          const leg = r.legs.find((l) => l.sequence === e.sequence),
            trip = leg?.mileageTrip;
          return {
            sequence: e.sequence,
            label:
              i === 0
                ? "Origin to stop 1"
                : i === expected.length - 1
                  ? `Stop ${i} to origin`
                  : `Stop ${i} to stop ${i + 1}`,
            start: trip?.startOdometerPrecise?.toFixed(2) ?? null,
            end: trip?.endOdometerPrecise?.toFixed(2) ?? null,
            actual: leg?.actualMiles?.toFixed(2) ?? null,
            planned: leg?.plannedMiles?.toFixed(2) ?? null,
          };
        }),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function saveRouteMileage(actor: string, raw: unknown) {
  const d = routeMileageInput.parse(raw);
  d.legs.sort((a, b) => a.sequence - b.sequence);
  const hash = createHash("sha256")
    .update(canonicalJson({ actor, ...d }))
    .digest("hex");
  const requestId =
    "route-mileage:" +
    createHash("sha256")
      .update(actor + ":" + d.requestKey)
      .digest("hex");
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Route" WHERE id=${d.routeId} FOR UPDATE`;
      const { route: r, expected } = await routeAccess(tx, actor, d.routeId, true);
      const prior = await tx.auditLog.findUnique({ where: { id: requestId } });
      if (prior) {
        const saved = prior.afterJson as { hash: string; version: number };
        if (saved.hash !== hash)
          throw new AccountError(
            "This save was used for different readings. Reload the saved route before changing them.",
            409,
          );
        return { version: saved.version };
      }
      if (r.mileageVersion !== d.version)
        throw new AccountError(
          "Mileage changed. Reload the route before correcting it.",
          409,
        );
      if (
        d.legs.length !== expected.length ||
        expected.some((e) => !d.legs.some((l) => l.sequence === e.sequence))
      )
        throw new AccountError("Include every route leg exactly once.", 409);
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${r.vehicleId} FOR UPDATE`;
      if (!(await tx.vehicle.findUnique({ where: { id: r.vehicleId! } }))?.isActive)
        throw new AccountError("This vehicle is inactive. Review the route first.", 409);
      if (await tx.mileageTrip.findFirst({ where: { routeId: r.id, routeLegId: null } }))
        throw new AccountError(
          "This route already has a legacy mileage trip. Reconcile it before adding leg records.",
          409,
        );
      const actuals = d.legs.filter((l) => l.start !== null);
      if (
        actuals.length &&
        (r.status === "SCHEDULED" ||
          r.serviceDate.toISOString().slice(0, 10) > businessDate())
      )
        throw new AccountError(
          "Record actual readings after the route starts, on today or a past service date.",
          409,
        );
      for (const l of actuals) {
        const e = expected.find((e) => e.sequence === l.sequence)!;
        const stop = r.stops.find((s) => s.id === e.toStopId);
        if (
          e.toStopId ? !(stop?.arrivedAt || stop?.completedAt) : r.status !== "COMPLETED"
        )
          throw new AccountError(
            "Finish travelling this leg before recording its actual mileage.",
            409,
          );
      }
      if (actuals.length) {
        const start = new Prisma.Decimal(actuals[0].start!),
          end = new Prisma.Decimal(actuals.at(-1)!.end!);
        const overlap = await tx.mileageTrip.findFirst({
          where: {
            vehicleId: r.vehicleId!,
            AND: [
              { OR: [{ routeId: null }, { routeId: { not: r.id } }] },
              {
                OR: [
                  {
                    startOdometer: { lt: Math.ceil(Number(end)) },
                    endOdometer: { gt: Math.floor(Number(start)) },
                  },
                  {
                    startOdometerPrecise: { lt: end },
                    endOdometerPrecise: { gt: start },
                  },
                ],
              },
            ],
          },
        });
        if (overlap)
          throw new AccountError(
            "Readings overlap another recorded trip for this vehicle.",
            409,
          );
      }
      for (const e of expected) {
        const l = d.legs.find((l) => l.sequence === e.sequence)!;
        const old = r.legs.find((leg) => leg.sequence === e.sequence);
        if (
          old?.actualMiles !== null &&
          old?.actualMiles !== undefined &&
          !old.mileageTrip
        )
          throw new AccountError(
            "Existing route distance has no matching odometer record. Review before changing it.",
            409,
          );
        if (old?.mileageTrip && l.start === null)
          throw new AccountError(
            "A recorded leg cannot be erased. Correct its readings with a reason.",
            409,
          );
        const miles =
          l.start === null
            ? null
            : ((hundredths(l.end!) - hundredths(l.start)) / 100).toFixed(2);
        const leg = await tx.routeLeg.upsert({
          where: { routeId_sequence: { routeId: r.id, sequence: e.sequence } },
          create: {
            routeId: r.id,
            ...e,
            actualMiles: miles,
            plannedMiles: l.planned,
            source:
              miles !== null
                ? "Recorded odometer readings"
                : "Staff distance estimate; actual not measured",
          },
          update: {
            actualMiles: miles,
            plannedMiles: l.planned,
            source:
              miles !== null
                ? "Recorded odometer readings"
                : "Staff distance estimate; actual not measured",
          },
        });
        if (miles !== null) {
          const before = old?.mileageTrip;
          if (before && (before.routeId !== r.id || before.vehicleId !== r.vehicleId))
            throw new AccountError(
              "Recorded mileage belongs to another vehicle or route. Review required.",
              409,
            );
          if (
            before?.startOdometerPrecise?.eq(l.start!) &&
            before.endOdometerPrecise?.eq(l.end!)
          )
            continue;
          const fields = {
            startOdometerPrecise: l.start!,
            endOdometerPrecise: l.end!,
            miles,
            startedAt: new Date(r.serviceDate.toISOString().slice(0, 10) + "T12:00:00Z"),
            endedAt: new Date(r.serviceDate.toISOString().slice(0, 10) + "T12:00:00Z"),
            purpose: `Delivery route ${r.number}, leg ${e.sequence}; recorded odometer distance`,
          };
          const trip = await tx.mileageTrip.upsert({
            where: { routeLegId: leg.id },
            create: {
              ...fields,
              routeLegId: leg.id,
              routeId: r.id,
              vehicleId: r.vehicleId!,
              driverUserId:
                r.stops.find((s) => s.id === e.toStopId)?.driverUserId ??
                r.stops.at(-1)!.driverUserId ??
                actor,
            },
            update: fields,
          });
          await tx.auditLog.create({
            data: {
              actorUserId: actor,
              entityType: "MileageTrip",
              entityId: trip.id,
              action: `finance.mileage.${before ? "corrected" : "recorded"}`,
              ...(before ? { beforeJson: json(before) } : {}),
              afterJson: json({ ...trip, reason: d.reason, routeVersion: d.version + 1 }),
            },
          });
        }
      }
      const sum = (key: "planned" | "actual") =>
        key === "planned"
          ? d.legs.every((l) => l.planned !== null)
            ? (d.legs.reduce((n, l) => n + hundredths(l.planned!), 0) / 100).toFixed(2)
            : null
          : actuals.length === d.legs.length
            ? (
                actuals.reduce(
                  (n, l) => n + hundredths(l.end!) - hundredths(l.start!),
                  0,
                ) / 100
              ).toFixed(2)
            : null;
      await tx.route.update({
        where: { id: r.id },
        data: {
          mileageVersion: { increment: 1 },
          actualMiles: sum("actual"),
          plannedMiles: sum("planned"),
        },
      });
      await tx.auditLog.create({
        data: {
          id: requestId,
          actorUserId: actor,
          entityType: "Route",
          entityId: r.id,
          action: "route.mileage.saved",
          beforeJson: json({ version: r.mileageVersion, legs: r.legs }),
          afterJson: json({ hash, version: d.version + 1, input: d }),
        },
      });
      return { version: d.version + 1 };
    },
    { timeout: 30000 },
  );
}
export type RouteMileageData = Awaited<ReturnType<typeof readRouteMileage>>;
