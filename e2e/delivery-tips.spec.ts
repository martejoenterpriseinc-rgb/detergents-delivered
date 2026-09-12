import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
import { deliveryTipFixture } from "../tests/delivery-tip-fixture";
test("optional tip decline survives a lost response without changing the original order", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    password = "Synthetic-Delivery-Tip-123";
  const f = await deliveryTipFixture(db, await bcrypt.hash(password, 4));
  try {
    const before = await db.order.findUnique({
      where: { id: f.orderId },
      include: { payments: true, items: true },
    });
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(f.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.goto(`/account/orders/${f.orderId}/tip`);
    await expect(
      page.getByRole("heading", { name: "Optional delivery tip", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue to tip payment", exact: true }),
    ).toBeDisabled();
    await page.route("**/api/account/tips", async (route) => {
      const r = await route.fetch();
      expect(r.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "No tip, thank you", exact: true }).click();
    await expect(page.getByRole("alert", { name: "Tip request error" })).toBeVisible();
    await page.unroute("**/api/account/tips");
    await page.getByRole("button", { name: "Retry tip request", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Your choice" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Reload tip status", exact: true }).click();
    await expect(page.getByText("Tip declined", { exact: true })).toBeVisible();
    expect(await db.deliveryTip.count({ where: { orderId: f.orderId } })).toBe(1);
    expect(
      await db.order.findUnique({
        where: { id: f.orderId },
        include: { payments: true, items: true },
      }),
    ).toEqual(before);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: info.outputPath("delivery-tips.png"), fullPage: true });
  } finally {
    await f.cleanup();
    await db.$disconnect();
  }
});
