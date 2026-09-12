import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
import { manualPaymentFixture } from "../tests/manual-payment-fixture";
test("payment overview links every KPI and retains large period controls and connection failures", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    password = "Synthetic-Payments-Overview-123";
  const f = await manualPaymentFixture(db, await bcrypt.hash(password, 4));
  try {
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(f.admin.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/payments");
    await expect(
      page.getByRole("heading", { name: "Payments", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Review delivery addresses" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open Stripe dashboard" }),
    ).toHaveAttribute("href", /^https:\/\/dashboard\.stripe\.com\//);
    await expect(
      page.getByRole("region", { name: "Stripe API connection" }),
    ).toContainText("Not connected");
    for (const period of ["Day", "Week", "Month", "Year"]) {
      const button = page.getByRole("link", { name: period, exact: true });
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await button.click();
      await expect(page).toHaveURL(new RegExp("period=" + period.toLowerCase()));
    }
    const overview = page.getByRole("region", { name: "Payment overview" });
    const links = await overview
      .getByRole("link")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")!));
    expect(links).toHaveLength(10);
    for (const link of links) {
      await page.goto(link);
      await expect(page.getByRole("link", { name: "Payments overview" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await page.goto("/admin/payments?period=month");
    await page.route("**/api/admin/payments/connection", (r) =>
      r.fulfill({ status: 503, body: "{}" }),
    );
    await page.getByRole("button", { name: "Refresh payments" }).click();
    await expect(
      page.getByRole("region", { name: "Stripe API connection" }),
    ).toContainText("Connection check failed");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("payment-overview.png"),
      fullPage: true,
    });
  } finally {
    await f.cleanup();
    await db.$disconnect();
  }
});
