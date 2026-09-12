import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
import { manualPaymentFixture } from "../tests/manual-payment-fixture";
test("cash and Zelle approvals retain lost saves, revocation and audit history", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    password = "Synthetic-Payment-Approval-123";
  const f = await manualPaymentFixture(db, await bcrypt.hash(password, 4));
  try {
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(f.admin.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto(`/admin/customers/${f.customer.id}/payment-approvals`);
    await page.getByLabel("Cash maximum per order (USD)", { exact: true }).fill("125.50");
    await page
      .getByLabel("Cash reason", { exact: true })
      .fill("Approved after customer request");
    await page.route("**/api/admin/manual-payment-approvals", async (route) => {
      const r = await route.fetch();
      expect(r.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Save Cash approval", exact: true }).click();
    await expect(page.getByRole("alert", { name: "Cash approval error" })).toBeVisible();
    await expect(
      page.getByLabel("Cash maximum per order (USD)", { exact: true }),
    ).toHaveValue("125.50");
    await page.unroute("**/api/admin/manual-payment-approvals");
    await page.getByRole("button", { name: "Retry Cash approval", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Cash approval saved" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Reload approvals", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Cash approval", exact: true }),
    ).toContainText("Limit $125.50");
    await page.getByLabel("Cash decision", { exact: true }).selectOption("false");
    await page
      .getByLabel("Cash reason", { exact: true })
      .fill("Customer requested revocation");
    await page.getByRole("button", { name: "Save Cash approval", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Cash approval saved" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Reload approvals", exact: true }).click();
    await page
      .getByLabel("Zelle reason", { exact: true })
      .fill("Approved Zelle for this customer");
    await page.getByRole("button", { name: "Save Zelle approval", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Zelle approval saved" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Reload approvals", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Cash approval", exact: true }),
    ).toContainText("Not approved");
    await expect(
      page.getByRole("region", { name: "Zelle approval", exact: true }),
    ).toContainText("Saved status: Approved");
    expect(
      await db.auditLog.count({
        where: { entityId: f.customer.id, action: "manual-payment.approval.saved" },
      }),
    ).toBe(3);
    expect(await db.order.count({ where: { customerId: f.customer.id } })).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("manual-payment-approvals.png"),
      fullPage: true,
    });
  } finally {
    await f.cleanup();
    await db.$disconnect();
  }
});
