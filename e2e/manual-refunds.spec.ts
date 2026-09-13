import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
import { receiptFixture } from "../tests/customer-receipt-fixture";
test("manual refund records a partial return once after a lost response", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    password = "Synthetic-Manual-Refund-123";
  const f = await receiptFixture(db, {
    financialEvidence: true,
    manual: "ZELLE",
    passwordHash: await bcrypt.hash(password, 4),
  });
  const role = await db.role.upsert({
    where: { code: "ADMIN" },
    update: {},
    create: { code: "ADMIN", name: "Admin" },
  });
  await db.userRole.create({ data: { userId: f.userId, roleId: role.id } });
  await db.user.update({ where: { id: f.userId }, data: { emailVerified: new Date() } });
  try {
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(f.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto(`/admin/payments/manual/${f.orderId}`);
    await page.getByLabel("Refund quantity for Original detergent bucket").fill("1");
    await page
      .getByLabel("Refund reason", { exact: true })
      .fill("One synthetic item returned for refund");
    await page.getByRole("button", { name: "Prepare refund", exact: true }).click();
    await expect(page.getByRole("heading", { name: "$7.56 · PREPARED" })).toBeVisible();
    await page
      .getByLabel("ZELLE return receipt reference")
      .fill("synthetic-return-" + f.orderId);
    // datetime-local is interpreted in the browser timezone, matching the user's input.
    const localTime = await page.evaluate(() => {
      const d = new Date();
      d.setMinutes(d.getMinutes() - 1);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    });
    await page.getByLabel("Money returned at (your local time)").fill(localTime);
    await page
      .getByLabel("Return evidence notes")
      .fill("Synthetic Zelle completed transfer receipt");
    await page.getByRole("checkbox").check();
    await page.route("**/api/admin/manual-refunds", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await page
      .getByRole("button", { name: "Record returned money", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
    await page.unroute("**/api/admin/manual-refunds");
    await page.getByRole("button", { name: "Retry same request" }).click();
    await expect(
      page.getByRole("heading", { name: "$7.56 · Money returned" }),
    ).toBeVisible();
    expect(await db.refund.count({ where: { orderId: f.orderId } })).toBe(1);
    expect(
      await db.rewardEntry.count({ where: { orderId: f.orderId, kind: "RESTORE" } }),
    ).toBe(1);
    await expect(
      page.getByLabel("Refund quantity for Original detergent bucket"),
    ).toHaveAttribute("max", "2");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("manual-refunds.png"),
      fullPage: true,
    });
  } finally {
    await db.user.update({ where: { id: f.userId }, data: { deletedAt: new Date() } });
    await db.$disconnect();
  }
});
