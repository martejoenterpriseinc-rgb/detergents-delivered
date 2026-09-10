import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";

test("expenses and mileage persist, recover lost saves, export and restrict CPA writes", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    marker = randomUUID();
  const users: string[] = [],
    expenseIds: string[] = [];
  const password = "Synthetic-Finance-Password-123",
    email = `finance-ui-${marker}@example.test`;
  const category = `finance-ui-${marker}`;
  const vehicle = await db.vehicle.create({
    data: { name: `Finance vehicle ${marker}` },
  });
  try {
    for (const [code, address] of [
      ["ADMIN", email],
      ["CPA", `cpa-${email}`],
    ] as const) {
      const role = await db.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      const user = await db.user.create({
        data: {
          email: address,
          passwordHash: await bcrypt.hash(password, 4),
          userRoles: { create: { roleId: role.id } },
        },
      });
      users.push(user.id);
    }
    const login = async (address: string) => {
      await page.goto("/sign-in");
      await page.getByLabel("Email", { exact: true }).fill(address);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
    };
    expect((await page.request.get("/api/admin/finance?kind=expense")).status()).toBe(
      401,
    );
    await login(email);
    await page.goto("/admin/expenses");
    await page.getByRole("button", { name: "+ Expense", exact: true }).click();
    await page.getByLabel("Category", { exact: true }).fill(category);
    await page.getByLabel("Amount (USD)", { exact: true }).fill("12.34");
    await page.getByLabel("Merchant / memo", { exact: true }).fill("Synthetic receipt");
    await page.route("**/api/admin/finance", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected finance save failure" }),
      }),
    );
    await page.getByRole("button", { name: "Save record", exact: true }).click();
    await expect(
      page.getByRole("alert", { name: "Save error", exact: true }),
    ).toContainText("Injected finance save failure");
    await expect(page.getByLabel("Amount (USD)", { exact: true })).toHaveValue("12.34");
    await page.unroute("**/api/admin/finance");
    await page.route("**/api/admin/finance", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Save record", exact: true }).click();
    await expect(
      page.getByRole("alert", { name: "Save error", exact: true }),
    ).toBeVisible();
    const saved = await db.expense.findMany({ where: { category: { name: category } } });
    expect(saved).toHaveLength(1);
    expenseIds.push(saved[0].id);
    await page.unroute("**/api/admin/finance");
    await page.getByRole("button", { name: "Save record", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Record saved.");
    expect(await db.expense.count({ where: { category: { name: category } } })).toBe(1);
    await page.reload();
    const card = page.locator("article").filter({ hasText: "Synthetic receipt" });
    await expect(card).toContainText("$12.34");
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Amount (USD)", { exact: true }).fill("15.01");
    await page
      .getByLabel("Reason for correction", { exact: true })
      .fill("Receipt amount corrected");
    await page.getByRole("button", { name: "Save record", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Correction saved");
    await expect(card).toContainText("$15.01");
    const exportUrl = await page
      .getByRole("link", { name: "Export CSV", exact: true })
      .getAttribute("href");
    const csv = await page.request.get(exportUrl!);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("15.01");
    await page.screenshot({ path: info.outputPath("expenses.png"), fullPage: true });
    await page.goto("/admin/mileage");
    await page.getByRole("button", { name: "+ Trip", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Vehicle", exact: true })
      .selectOption(vehicle.id);
    await page.getByLabel("Starting odometer", { exact: true }).fill("1000");
    await page.getByLabel("Ending odometer", { exact: true }).fill("1012");
    await page
      .getByLabel("Business purpose", { exact: true })
      .fill("Synthetic delivery trip");
    await page.getByRole("button", { name: "Save record", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Record saved.");
    await page.reload();
    await expect(
      page.locator("article").filter({ hasText: "Synthetic delivery trip" }),
    ).toContainText("12.00 miles");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("mileage.png"), fullPage: true });
    const crossOrigin = await page.request.post("/api/admin/finance", {
      headers: { origin: "https://untrusted.example" },
      data: {},
    });
    expect(crossOrigin.status()).toBe(403);
    await page.context().clearCookies();
    await login(`cpa-${email}`);
    await page.goto("/admin/expenses");
    await expect(
      page.getByRole("button", { name: "+ Expense", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    const denied = await page.request.post("/api/admin/finance", {
      headers: { origin: "http://localhost:3000" },
      data: {
        kind: "expense",
        requestKey: randomUUID(),
        version: 0,
        date: "2026-01-15",
        category,
        amount: "1.00",
        memo: "Should fail",
      },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await db.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
    await db.expense.deleteMany({
      where: { OR: [{ id: { in: expenseIds } }, { category: { name: category } }] },
    });
    await db.expenseCategory.deleteMany({ where: { name: category } });
    await db.mileageTrip.deleteMany({ where: { vehicleId: vehicle.id } });
    await db.vehicle.delete({ where: { id: vehicle.id } });
    await db.userRole.deleteMany({ where: { userId: { in: users } } });
    await db.user.updateMany({
      where: { id: { in: users } },
      data: { deletedAt: new Date() },
    });
    await db.$disconnect();
  }
});
