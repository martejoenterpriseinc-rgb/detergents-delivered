import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { readFinance, saveFinance } from "./finance";

const marker = randomUUID(),
  users: string[] = [],
  ids: string[] = [];
let admin: string, cpa: string, employee: string, vehicle: string;
const input = () => ({
  kind: "expense",
  requestKey: randomUUID(),
  version: 0,
  date: "2026-01-15",
  category: `finance-${marker}`,
  amount: "12.34",
  memo: "Synthetic expense",
});
beforeAll(async () => {
  for (const roleCode of ["ADMIN", "CPA", "INVENTORY"] as const) {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode, name: roleCode },
    });
    const user = await prisma.user.create({
      data: {
        email: `finance-${roleCode}-${marker}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(user.id);
  }
  [admin, cpa, employee] = users;
  vehicle = (await prisma.vehicle.create({ data: { name: `Finance ${marker}` } })).id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.expense.deleteMany({ where: { id: { in: ids } } });
  await prisma.expenseCategory.deleteMany({ where: { name: `finance-${marker}` } });
  await prisma.mileageTrip.deleteMany({ where: { vehicleId: vehicle } });
  await prisma.vehicle.delete({ where: { id: vehicle } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});
describe("native finance persistence", () => {
  it("excludes foreign currency totals and protects accounting-linked expenses", async () => {
    const data = input(),
      saved = await saveFinance(admin, data);
    ids.push(saved.id);
    const before = await readFinance(cpa, "expense", {
      from: "2026-01-01",
      to: "2026-01-31",
    });
    const source = await prisma.expense.findUniqueOrThrow({ where: { id: saved.id } });
    const foreign = await prisma.expense.create({
      data: {
        categoryId: source.categoryId,
        amountCents: 999999,
        currency: "CAD",
        incurredOn: source.incurredOn,
        memo: "Synthetic CAD",
      },
    });
    ids.push(foreign.id);
    const after = await readFinance(
      cpa,
      "expense",
      { from: "2026-01-01", to: "2026-01-31" },
      true,
    );
    expect(after.total).toBe(before.total);
    expect(after.rows.find((r) => r.id === foreign.id)).toMatchObject({
      currency: "CAD",
      editable: false,
    });
    await prisma.expense.update({
      where: { id: saved.id },
      data: { qboTxnId: `synthetic-${marker}` },
    });
    await expect(
      saveFinance(admin, {
        ...data,
        id: saved.id,
        version: 1,
        requestKey: randomUUID(),
        reason: "Correction",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await prisma.user.update({
      where: { id: admin },
      data: { mustChangeCredentials: true },
    });
    try {
      await expect(readFinance(admin, "expense", {})).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      await prisma.user.update({
        where: { id: admin },
        data: { mustChangeCredentials: false },
      });
    }
  });
  it("serializes duplicate expense saves and rejects a changed retry", async () => {
    const data = input();
    const saved = await Promise.all([saveFinance(admin, data), saveFinance(admin, data)]);
    ids.push(saved[0].id);
    expect(saved[0]).toEqual(saved[1]);
    expect(await prisma.expense.count({ where: { id: saved[0].id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: saved[0].id } })).toBe(1);
    await expect(saveFinance(admin, { ...data, amount: "20.00" })).rejects.toMatchObject({
      status: 409,
    });
  });
  it("allows only one concurrent correction and retains the previous amount", async () => {
    const data = input(),
      saved = await saveFinance(admin, data);
    ids.push(saved.id);
    const update = {
      ...data,
      id: saved.id,
      version: 1,
      amount: "15.01",
      reason: "Receipt corrected",
    };
    const results = await Promise.allSettled([
      saveFinance(admin, { ...update, requestKey: randomUUID() }),
      saveFinance(admin, { ...update, requestKey: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: saved.id, action: "finance.expense.corrected" },
    });
    expect(audit?.beforeJson).toMatchObject({ amountCents: 1234 });
    expect(
      (await prisma.expense.findUnique({ where: { id: saved.id } }))?.amountCents,
    ).toBe(1501);
  });
  it("permits CPA reads but refuses CPA and inventory writes/reads as appropriate", async () => {
    expect(
      (await readFinance(cpa, "expense", { from: "2026-01-01", to: "2026-01-31" }))
        .canWrite,
    ).toBe(false);
    await expect(saveFinance(cpa, input())).rejects.toMatchObject({ status: 403 });
    await expect(readFinance(employee, "expense", {})).rejects.toMatchObject({
      status: 403,
    });
    await expect(saveFinance(employee, input())).rejects.toMatchObject({ status: 403 });
  });
  it("locks a vehicle to prevent overlapping trips and derives miles", async () => {
    const trip = {
      kind: "mileage",
      requestKey: randomUUID(),
      version: 0,
      date: "2026-01-15",
      vehicleId: vehicle,
      purpose: "Synthetic delivery",
      startOdometer: 1000,
      endOdometer: 1012,
    };
    const results = await Promise.allSettled([
      saveFinance(admin, trip),
      saveFinance(admin, {
        ...trip,
        requestKey: randomUUID(),
        startOdometer: 1005,
        endOdometer: 1020,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const row = await prisma.mileageTrip.findFirst({ where: { vehicleId: vehicle } });
    expect(Number(row?.miles)).toBe(row!.endOdometer! - row!.startOdometer!);
    const successful = results.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<{ id: string; version: number }>;
    const accepted =
      row?.startOdometer === 1000
        ? trip
        : { ...trip, startOdometer: 1005, endOdometer: 1020 };
    await saveFinance(admin, {
      ...accepted,
      requestKey: randomUUID(),
      id: successful.value.id,
      version: 1,
      reason: "Purpose corrected",
      purpose: "Delivery route",
    });
  });
  it("rolls back an expense if its audit cannot be recorded", async () => {
    const data = input();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION dd_finance_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'finance.%' THEN RAISE EXCEPTION 'synthetic finance audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER dd_finance_test_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION dd_finance_test_fail()`,
    );
    const before = await prisma.expense.count();
    try {
      await expect(saveFinance(admin, data)).rejects.toThrow(
        "synthetic finance audit failure",
      );
      expect(await prisma.expense.count()).toBe(before);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER dd_finance_test_fail ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION dd_finance_test_fail()`);
    }
  });
});
