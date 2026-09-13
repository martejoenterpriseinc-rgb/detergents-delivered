import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
import { manualPaymentFixture } from "../tests/manual-payment-fixture";
test("payment overview links every KPI and retains large period controls and connection failures", async ({
  page,
}, info) => {
  test.setTimeout(120000);
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
    for (const [period, value] of [
      ["Today", "day"],
      ["Yesterday", "yesterday"],
      ["Week", "week"],
      ["Month to date", "month"],
      ["Previous month", "previousMonth"],
      ["Year", "year"],
    ]) {
      const button = page.getByRole("link", { name: period, exact: true });
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await button.click();
      await expect(page).toHaveURL(new RegExp("period=" + value));
    }
    const overview = page.getByRole("region", { name: "Payment overview" });
    const links = await overview
      .getByRole("link")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")!));
    expect(links).toHaveLength(30);
    for (const link of links) {
      await page.goto(link);
      await expect(page.getByRole("link", { name: "Payments overview" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const exportUrl = await page
        .getByRole("link", { name: "Export CSV", exact: true })
        .getAttribute("href");
      const csv = await page.request.get(exportUrl!);
      expect(csv.status()).toBe(200);
      expect(csv.headers()["cache-control"]).toContain("no-store");
      expect(await csv.text()).toContain("Amount USD");
    }
    await page.goto("/admin/payments?period=month");
    await page.getByLabel("Payment method", { exact: true }).selectOption("ZELLE");
    await page.getByLabel("Sort records", { exact: true }).selectOption("amountDesc");
    await page.getByLabel("Trend interval", { exact: true }).selectOption("week");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page).toHaveURL(/method=ZELLE/);
    await expect(page.getByLabel("Sort records", { exact: true })).toHaveValue(
      "amountDesc",
    );
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
