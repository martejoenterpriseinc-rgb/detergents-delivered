import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { receiptFixture } from "@/tests/customer-receipt-fixture";
import { readCpaLedger } from "./cpa-ledger";
import { recordStockReturn } from "./refunds";
import { businessDate } from "@/lib/domain/operations";
let admin: string, cpa: string;
let fixture: Awaited<ReturnType<typeof receiptFixture>>;
const users: string[] = [];
beforeAll(async () => {
  for (const code of ["ADMIN", "CPA"] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const user = await prisma.user.create({
      data: {
        email: `ledger-${randomUUID()}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(user.id);
  }
  [admin, cpa] = users;
  fixture = await receiptFixture(prisma, { financialEvidence: true });
  users.push(fixture.userId);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
it("reads complete original amounts for CPA, blocks customers and isolates environments", async () => {
  const filter = { orderId: fixture.orderId, from: "2026-02-01", to: "2026-02-01" };
  const data = await readCpaLedger(cpa, filter);
  expect(data).toMatchObject({ count: 1, attention: 0, merchandiseLessCostCents: 900 });
  expect(data.totals).toMatchObject({
    cashCents: 2268,
    netCents: 2100,
    taxCents: 168,
    rewardCents: -600,
    costCents: 1200,
    subtotalCents: 3000,
    promotionCents: 300,
  });
  await expect(readCpaLedger(fixture.userId, filter)).rejects.toMatchObject({
    status: 403,
  });
  try {
    vi.stubEnv("APP_ENV", "production");
    expect((await readCpaLedger(cpa, filter)).count).toBe(0);
  } finally {
    vi.unstubAllEnvs();
  }
});
it("keeps sellable and damaged return costs separate from cash and sale period", async () => {
  const item = await prisma.orderItem.findFirstOrThrow({
    where: { orderId: fixture.orderId },
  });
  await prisma.inventoryBalance.create({
    data: { productVariantId: item.productVariantId },
  });
  for (const condition of ["SELLABLE", "DAMAGED"] as const) {
    await recordStockReturn(admin, {
      orderId: fixture.orderId,
      requestKey: randomUUID(),
      reason: "Synthetic ledger return",
      lines: [{ orderItemId: item.id, quantity: 1, condition }],
    });
  }
  const data = await readCpaLedger(cpa, {
    orderId: fixture.orderId,
    from: businessDate(),
    to: businessDate(),
  });
  expect(data.count).toBe(2);
  expect(data.totals).toMatchObject({
    cashCents: 0,
    netCents: 0,
    taxCents: 0,
    rewardCents: 0,
    costCents: -400,
  });
  expect(data.rows.map((r) => r.costCents).sort()).toEqual([-400, -0]);
});
it("flags incomplete history instead of manufacturing zero amounts", async () => {
  const incomplete = await receiptFixture(prisma);
  users.push(incomplete.userId);
  const filter = { orderId: incomplete.orderId, from: "2026-02-01", to: "2026-02-01" };
  const before = await prisma.auditLog.count({ where: { entityId: incomplete.orderId } });
  const data = await readCpaLedger(cpa, filter, true);
  expect(data).toMatchObject({
    count: 1,
    missingFinancial: 1,
    missingCost: 1,
    merchandiseLessCostCents: null,
  });
  expect(data.rows[0]).toMatchObject({ cashCents: null, costCents: null });
  expect(await prisma.auditLog.count({ where: { entityId: incomplete.orderId } })).toBe(
    before,
  );
});
