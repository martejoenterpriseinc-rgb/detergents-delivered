import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
import { mileageFixture } from "../tests/route-mileage-fixture";
test("route odometers survive lost saves, report once and preserve correction evidence", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] });
  const password = "Synthetic-Mileage-Password-123";
  const f = await mileageFixture(db, await bcrypt.hash(password, 4));
  try {
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(f.admin.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto(`/admin/deliveries/${f.route.id}/mileage`);
    await expect(
      page.getByRole("heading", { name: "Route mileage", exact: true }),
    ).toBeVisible();
    const labels = ["Origin to stop 1", "Stop 1 to stop 2", "Stop 2 to origin"];
    const readings = ["1000.25", "1002.50", "1003.75", "1005.00"];
    for (let i = 0; i < labels.length; i++) {
      await page.getByLabel(`${labels[i]}: start`, { exact: true }).fill(readings[i]);
      await page.getByLabel(`${labels[i]}: end`, { exact: true }).fill(readings[i + 1]);
      await page.getByLabel(`${labels[i]}: planned`, { exact: true }).fill("2");
    }
    await page.route("**/api/admin/operations/mileage", async (route) => {
      const r = await route.fetch();
      expect(r.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Save mileage", exact: true }).click();
    await expect(page.getByRole("alert", { name: "Mileage save error" })).toBeVisible();
    await expect(page.getByLabel("Origin to stop 1: start", { exact: true })).toHaveValue(
      "1000.25",
    );
    expect(await db.mileageTrip.count({ where: { routeId: f.route.id } })).toBe(3);
    await page.unroute("**/api/admin/operations/mileage");
    await page.getByRole("button", { name: "Save mileage", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Mileage saved" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Reload saved mileage", exact: true }).click();
    await expect(page.getByText(/Actual: 4.75 miles/)).toBeVisible();
    expect(await db.mileageTrip.count({ where: { routeId: f.route.id } })).toBe(3);
    await page.getByLabel("Origin to stop 1: start", { exact: true }).fill("1000.00");
    await page
      .getByLabel("Reason for update (required)", { exact: true })
      .fill("Corrected from driver odometer photo");
    await page.getByRole("button", { name: "Save mileage", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Mileage saved" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Reload saved mileage", exact: true }).click();
    await expect(page.getByText(/Actual: 5.00 miles/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: info.outputPath("route-mileage.png"), fullPage: true });
    await page.goto("/admin/mileage");
    await expect(page.locator("article").filter({ hasText: f.route.number })).toHaveCount(
      3,
    );
    expect(
      await db.auditLog.count({
        where: {
          entityType: "Route",
          entityId: f.route.id,
          action: "route.mileage.saved",
        },
      }),
    ).toBe(2);
  } finally {
    await f.cleanup();
    await db.$disconnect();
  }
});
