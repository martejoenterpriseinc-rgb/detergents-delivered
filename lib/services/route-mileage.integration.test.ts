import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mileageFixture } from "@/tests/route-mileage-fixture";
import { readRouteMileage, saveRouteMileage } from "./route-mileage";
import { readFinance, saveFinance } from "./finance";
import { businessDate } from "@/lib/domain/operations";
afterAll(() => prisma.$disconnect());
const readings = (routeId: string) => ({
  routeId,
  requestKey: randomUUID(),
  version: 0,
  legs: [
    { sequence: 1, start: "1000.25", end: "1002.50", planned: "2" },
    { sequence: 2, start: "1002.50", end: "1003.75", planned: "1" },
    { sequence: 3, start: "1003.75", end: "1005.00", planned: "2" },
  ],
});
it("records legs once, exposes CPA mileage and allows only assigned drivers or admins to write", async () => {
  const f = await mileageFixture(prisma);
  try {
    const d = readings(f.route.id);
    await expect(saveRouteMileage(f.cpa.id, d)).rejects.toMatchObject({ status: 403 });
    await expect(readRouteMileage(f.outsider.id, f.route.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(readRouteMileage(f.stranger.id, f.route.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(saveRouteMileage(f.stranger.id, d)).rejects.toMatchObject({
      status: 403,
    });
    const both = await Promise.all([
      saveRouteMileage(f.driver.id, d),
      saveRouteMileage(f.driver.id, d),
    ]);
    expect(both).toEqual([{ version: 1 }, { version: 1 }]);
    expect(await prisma.mileageTrip.count({ where: { routeId: f.route.id } })).toBe(3);
    expect(await readRouteMileage(f.cpa.id, f.route.id)).toMatchObject({
      actual: "4.75",
      planned: "5.00",
      canWrite: false,
    });
    const report = await readFinance(
      f.cpa.id,
      "mileage",
      { from: businessDate(), to: businessDate() },
      true,
    );
    const rows = report.rows.filter((r) => r.routeId === f.route.id);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((n, r) => n + Number(r.amount), 0)).toBe(4.75);
    expect(rows.every((r) => !r.editable && r.version === 1)).toBe(true);
    await expect(
      saveRouteMileage(f.driver.id, { ...d, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await saveRouteMileage(f.admin.id, {
      ...d,
      requestKey: randomUUID(),
      version: 1,
      reason: "Correct first odometer from driver photo",
      legs: [{ ...d.legs[0], start: "1000.00" }, ...d.legs.slice(1)],
    });
    expect((await readRouteMileage(f.cpa.id, f.route.id)).actual).toBe("5.00");
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "Route",
          entityId: f.route.id,
          action: "route.mileage.saved",
        },
      }),
    ).toBe(2);
  } finally {
    await f.cleanup();
  }
});
it("leaves partial actual totals unknown, blocks erasure and rejects overlapping manual trips in both directions", async () => {
  const f = await mileageFixture(prisma);
  try {
    const d = readings(f.route.id);
    await saveRouteMileage(f.driver.id, {
      ...d,
      legs: d.legs.map((l, i) => (i ? { ...l, start: null, end: null } : l)),
    });
    expect((await readRouteMileage(f.cpa.id, f.route.id)).actual).toBeNull();
    await expect(
      saveRouteMileage(f.driver.id, {
        ...d,
        requestKey: randomUUID(),
        version: 1,
        reason: "Erase",
        legs: d.legs.map((l) => ({ ...l, start: null, end: null })),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      saveFinance(f.admin.id, {
        kind: "mileage",
        requestKey: randomUUID(),
        version: 0,
        date: businessDate(),
        vehicleId: f.vehicle.id,
        startOdometer: 1001,
        endOdometer: 1002,
        purpose: "Overlapping trip",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await saveFinance(f.admin.id, {
      kind: "mileage",
      requestKey: randomUUID(),
      version: 0,
      date: businessDate(),
      vehicleId: f.vehicle.id,
      startOdometer: 1004,
      endOdometer: 1006,
      purpose: "Existing manual trip",
    });
    await expect(
      saveRouteMileage(f.driver.id, {
        ...d,
        requestKey: randomUUID(),
        version: 1,
        reason: "Finish route",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.mileageTrip.count({ where: { routeId: f.route.id } })).toBe(1);
  } finally {
    await f.cleanup();
  }
});
it("rolls back every mileage write when its audit fails", async () => {
  const f = await mileageFixture(prisma);
  try {
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION dd_route_mileage_test_fail() RETURNS trigger AS $$ BEGIN IF NEW.action = 'route.mileage.saved' THEN RAISE EXCEPTION 'synthetic route mileage audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER dd_route_mileage_test_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION dd_route_mileage_test_fail()`,
    );
    await expect(saveRouteMileage(f.driver.id, readings(f.route.id))).rejects.toThrow();
    expect(await prisma.mileageTrip.count({ where: { routeId: f.route.id } })).toBe(0);
    expect(await prisma.routeLeg.count({ where: { routeId: f.route.id } })).toBe(0);
    expect(
      (await prisma.route.findUniqueOrThrow({ where: { id: f.route.id } }))
        .mileageVersion,
    ).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS dd_route_mileage_test_fail ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS dd_route_mileage_test_fail()",
    );
    await f.cleanup();
  }
});
