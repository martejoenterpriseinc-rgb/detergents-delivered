import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
test("financial report navigation keeps unavailable provider amounts distinct from zero", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    password = "Synthetic-Report-123";
  const role = await db.role.upsert({
    where: { code: "CPA" },
    update: {},
    create: { code: "CPA", name: "CPA" },
  });
  const user = await db.user.create({
    data: {
      email: `report-${randomUUID()}@example.test`,
      passwordHash: await bcrypt.hash(password, 4),
      userRoles: { create: { roleId: role.id } },
    },
  });
  try {
    expect(
      (await page.request.get("/api/admin/quickbooks/financial-report")).status(),
    ).toBe(401);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(user.email!);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin/);
    await page.goto("/admin/reports/quickbooks/financial");
    await expect(
      page.getByRole("heading", { name: "Financial reports", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "Financial amounts are unavailable" }),
    ).toBeVisible();
    await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
    const period = page.getByRole("navigation", { name: "Financial reporting period" });
    await period.getByRole("link", { name: "Year", exact: true }).click();
    await expect(page).toHaveURL(/period=year/);
    const size = await period
      .getByRole("link", { name: "Year", exact: true })
      .boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(56);
    await page
      .getByRole("navigation", { name: "Financial report", exact: true })
      .getByRole("link", { name: "Balance sheet", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Balance sheet", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Balances as of/)).toBeVisible();
    await page.getByRole("link", { name: "Cash basis", exact: true }).click();
    await expect(page).toHaveURL(/basis=Cash/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("financial-reports-unavailable.png"),
      fullPage: true,
    });
  } finally {
    await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    await db.$disconnect();
  }
});
