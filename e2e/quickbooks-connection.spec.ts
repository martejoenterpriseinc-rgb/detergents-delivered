import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sealIntegration } from "../lib/integrations/secrets";
import "../tests/integration-guard";
test("QuickBooks intended-company confirmation, failed connection and CPA isolation", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    marker = randomUUID(),
    users: string[] = [],
    key = "integrations:v1:sandbox:quickbooks",
    password = "Synthetic-Qbo-Password-123";
  const original = await db.setting.findUnique({ where: { key } });
  try {
    const values = {
      QUICKBOOKS_CLIENT_ID: "synthetic-browser-client",
      QUICKBOOKS_CLIENT_SECRET: "synthetic-browser-secret",
      QUICKBOOKS_REALM_ID: "123456789",
    };
    const valueJson = {
      version: 1,
      ...sealIntegration({ values, changedAt: {} }, key + ":1"),
    };
    await db.setting.upsert({
      where: { key },
      create: { key, valueJson },
      update: { valueJson },
    });
    for (const code of ["ADMIN", "CPA"] as const) {
      const role = await db.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      const user = await db.user.create({
        data: {
          email: `qbo-${code.toLowerCase()}-${marker}@example.test`,
          passwordHash: await bcrypt.hash(password, 4),
          userRoles: { create: { roleId: role.id } },
        },
      });
      users.push(user.id);
    }
    const login = async (role: string) => {
      await page.goto("/sign-in");
      await page
        .getByLabel("Email", { exact: true })
        .fill(`qbo-${role}-${marker}@example.test`);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
    };
    expect((await page.request.get("/api/admin/quickbooks")).status()).toBe(401);
    await login("admin");
    await page.goto("/admin/reports");
    await page.getByRole("link", { name: "QuickBooks connection", exact: true }).click();
    await expect(page.getByText("Intended company: 123456789")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect to QuickBooks", exact: true }),
    ).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page.route("**/api/admin/quickbooks", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic connection unavailable" }),
      }),
    );
    await page
      .getByRole("button", { name: "Connect to QuickBooks", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic connection unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await page.screenshot({
      path: info.outputPath("quickbooks-connection.png"),
      fullPage: true,
    });
    await page.unroute("**/api/admin/quickbooks");
    await page.context().clearCookies();
    await login("cpa");
    await page.goto("/admin/reports/quickbooks?connection=connected");
    await expect(page.getByText("Your accounting access is read-only.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect to QuickBooks", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "QuickBooks authorization was saved. Accounting posting is still off.",
      ),
    ).toHaveCount(0);
    const denied = await page.request.post("/api/admin/quickbooks", {
      headers: { Origin: "http://localhost:3000" },
      data: { action: "connect", confirmed: true },
    });
    expect(denied.status()).toBe(403);
  } finally {
    if (original)
      await db.setting.upsert({
        where: { key },
        create: { key, valueJson: original.valueJson as Prisma.InputJsonValue },
        update: { valueJson: original.valueJson as Prisma.InputJsonValue },
      });
    else await db.setting.deleteMany({ where: { key } });
    await db.user.updateMany({
      where: { id: { in: users } },
      data: { deletedAt: new Date() },
    });
    await db.$disconnect();
  }
});
