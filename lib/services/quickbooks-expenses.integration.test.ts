import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sealIntegration } from "@/lib/integrations/secrets";
import * as provider from "@/lib/integrations/quickbooks-client";
import {
  prepareQuickbooksExpense,
  cancelQuickbooksExpense,
  submitQuickbooksExpense,
  reconcileQuickbooksExpense,
} from "./quickbooks-expenses";
const key = "quickbooks:connection:v1:sandbox",
  config = {
    mode: "sandbox" as const,
    clientId: "synthetic",
    clientSecret: "synthetic",
    realm: "87654321",
    fingerprint: "synthetic-expense",
    redirectUri: "http://localhost:3000/api/admin/quickbooks/callback",
  };
let original: Prisma.JsonValue | undefined, admin: string, cpa: string, expenseId: string;
const users: string[] = [],
  mapKeys: string[] = [];
beforeAll(async () => {
  original = (await prisma.setting.findUnique({ where: { key } }))?.valueJson;
  for (const code of ["ADMIN", "CPA"] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const u = await prisma.user.create({
      data: {
        email: `qbo-expense-${randomUUID()}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(u.id);
  }
  [admin, cpa] = users;
});
beforeEach(async () => {
  const connection = {
    version: 1,
    status: "CONNECTED",
    fingerprint: config.fingerprint,
    realm: config.realm,
    companyName: "Synthetic company",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    changedAt: new Date().toISOString(),
    secret: sealIntegration(
      {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        token_type: "bearer",
        expires_in: 3600,
      },
      key + ":1",
    ),
  };
  await prisma.setting.upsert({
    where: { key },
    create: { key, valueJson: connection },
    update: { valueJson: connection },
  });
  const category = await prisma.expenseCategory.create({
      data: { name: "synthetic-export-" + randomUUID() },
    }),
    e = await prisma.expense.create({
      data: {
        categoryId: category.id,
        amountCents: 1234,
        incurredOn: new Date("2026-09-01"),
        memo: "Synthetic expense",
      },
    });
  expenseId = e.id;
  const mapKey = `quickbooks:expense-map:v1:sandbox:${config.realm}:${category.id}`;
  mapKeys.push(mapKey);
  await prisma.setting.create({
    data: {
      key: mapKey,
      valueJson: {
        version: 1,
        mode: "sandbox",
        realm: config.realm,
        categoryId: category.id,
        expenseAccount: {
          id: "1",
          name: "Synthetic expenses",
          type: "Expense",
          currency: "USD",
        },
        paymentAccount: {
          id: "2",
          name: "Synthetic bank",
          type: "Bank",
          currency: "USD",
        },
        verifiedAt: new Date().toISOString(),
      },
    },
  });
  vi.spyOn(provider, "quickbooksConfig").mockResolvedValue(config);
  vi.spyOn(provider, "readQuickbooksAccount").mockImplementation(async (_c, _t, id) => ({
    Id: id,
    Name: "Synthetic",
    AccountType: id === "1" ? "Expense" : "Bank",
    Active: true,
    CurrencyRef: { value: "USD" },
  }));
  vi.stubEnv("DD_QBO_EXPENSE_POSTING_ENABLED", "true");
  vi.stubEnv("DD_QBO_EXPENSE_POSTING_COMPANY", "sandbox:" + config.realm);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: [key, ...mapKeys] } } });
  if (original)
    await prisma.setting.create({
      data: { key, valueJson: original as Prisma.InputJsonValue },
    });
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
const input = () => ({
  requestKey: randomUUID(),
  expenseId,
  paymentType: "Cash",
  confirmed: true,
});
async function receipt(id: string, externalId = "123") {
  const row = await prisma.qboExpenseExport.findUniqueOrThrow({ where: { id } });
  return { ...(row.payload as Prisma.JsonObject), Id: externalId, TotalAmt: 12.34 };
}
it("prepares one immutable draft across retries, freezes source edits and allows only unsubmitted cancellation", async () => {
  const raw = input(),
    [one, two] = await Promise.all([
      prepareQuickbooksExpense(admin, raw),
      prepareQuickbooksExpense(admin, raw),
    ]);
  expect(one.id).toBe(two.id);
  await expect(
    prisma.expense.update({ where: { id: expenseId }, data: { amountCents: 2000 } }),
  ).rejects.toThrow();
  await expect(
    prisma.qboExpenseExport.update({
      where: { id: one.id },
      data: { payload: { other: true } },
    }),
  ).rejects.toThrow();
  await expect(prepareQuickbooksExpense(cpa, input())).rejects.toMatchObject({
    status: 403,
  });
  await cancelQuickbooksExpense(admin, one.id);
  await cancelQuickbooksExpense(admin, one.id);
  await prisma.expense.update({ where: { id: expenseId }, data: { amountCents: 1235 } });
  expect((await prepareQuickbooksExpense(admin, input())).source.amountCents).toBe(1235);
});
it("makes one provider submission across concurrent calls and reconciles a lost response exactly once", async () => {
  const draft = await prepareQuickbooksExpense(admin, input()),
    create = vi
      .spyOn(provider, "createQuickbooksExpense")
      .mockRejectedValue(new Error("synthetic lost response"));
  vi.stubEnv("DD_QBO_EXPENSE_POSTING_ENABLED", "false");
  await expect(submitQuickbooksExpense(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  expect(create).not.toHaveBeenCalled();
  vi.stubEnv("DD_QBO_EXPENSE_POSTING_ENABLED", "true");
  await Promise.allSettled([
    submitQuickbooksExpense(admin, draft.id),
    submitQuickbooksExpense(admin, draft.id),
  ]);
  expect(create).toHaveBeenCalledTimes(1);
  expect(
    (await prisma.qboExpenseExport.findUniqueOrThrow({ where: { id: draft.id } })).status,
  ).toBe("UNKNOWN");
  await submitQuickbooksExpense(admin, draft.id);
  expect(create).toHaveBeenCalledTimes(1);
  await expect(cancelQuickbooksExpense(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  await expect(prepareQuickbooksExpense(admin, input())).rejects.toMatchObject({
    status: 409,
  });
  vi.spyOn(provider, "findQuickbooksExpense").mockResolvedValue([
    await receipt(draft.id, "101"),
  ]);
  vi.stubEnv("DD_QBO_EXPENSE_POSTING_ENABLED", "false");
  await Promise.all([
    reconcileQuickbooksExpense(admin, draft.id),
    reconcileQuickbooksExpense(admin, draft.id),
  ]);
  expect(
    (await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).qboTxnId,
  ).toBe("qbo:sandbox:87654321:101");
  expect(
    await prisma.auditLog.count({
      where: { entityId: draft.id, action: "quickbooks.expense.confirmed" },
    }),
  ).toBe(1);
});
it("rolls back receipt linkage on audit failure and recovers by read-only reconciliation", async () => {
  const draft = await prepareQuickbooksExpense(admin, input());
  vi.spyOn(provider, "createQuickbooksExpense").mockResolvedValue(
    await receipt(draft.id, "102"),
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "qbo_expense_audit" CHECK (action <> 'quickbooks.expense.confirmed') NOT VALID`,
  );
  try {
    await expect(submitQuickbooksExpense(admin, draft.id)).rejects.toMatchObject({
      status: 503,
    });
    expect(
      (await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).qboTxnId,
    ).toBeNull();
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "qbo_expense_audit"',
    );
  }
  vi.spyOn(provider, "findQuickbooksExpense").mockResolvedValue([
    await receipt(draft.id, "102"),
  ]);
  await reconcileQuickbooksExpense(admin, draft.id);
  await expect(
    prisma.qboExpenseExport.update({
      where: { id: draft.id },
      data: { externalId: "999" },
    }),
  ).rejects.toThrow();
  await expect(
    prisma.expense.update({ where: { id: expenseId }, data: { qboTxnId: null } }),
  ).rejects.toThrow();
});
it("rejects wrong-company, ambiguous and mismatched provider evidence without creating another transaction", async () => {
  const draft = await prepareQuickbooksExpense(admin, input()),
    create = vi
      .spyOn(provider, "createQuickbooksExpense")
      .mockRejectedValue(new Error("synthetic timeout"));
  await expect(submitQuickbooksExpense(admin, draft.id)).rejects.toThrow();
  const find = vi.spyOn(provider, "findQuickbooksExpense").mockResolvedValue([]);
  await expect(reconcileQuickbooksExpense(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  find.mockResolvedValue([
    await receipt(draft.id, "103"),
    await receipt(draft.id, "104"),
  ]);
  await expect(reconcileQuickbooksExpense(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  find.mockResolvedValue([{ ...(await receipt(draft.id, "103")), TotalAmt: 99 }]);
  await expect(reconcileQuickbooksExpense(admin, draft.id)).rejects.toThrow();
  expect(
    (await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).qboTxnId,
  ).toBeNull();
  vi.mocked(provider.quickbooksConfig).mockResolvedValue({
    ...config,
    realm: "999",
    fingerprint: "changed",
  });
  await expect(reconcileQuickbooksExpense(admin, draft.id)).rejects.toMatchObject({
    status: 409,
  });
  expect(create).toHaveBeenCalledTimes(1);
});
