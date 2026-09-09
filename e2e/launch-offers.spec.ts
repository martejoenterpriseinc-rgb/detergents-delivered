import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test, expect, type Page } from "@playwright/test";
import { operationsFixture, operationsPassword } from "../tests/operations-fixture";
test("shop, support KPI, configurable launch and promotions persist with customer isolation", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const db = new PrismaClient();
  const f = await operationsFixture(db);
  const customerContext = await browser.newContext({ viewport: page.viewportSize()! });
  const customer = await customerContext.newPage();
  async function login(p: Page, email: string) {
    await p.goto("/sign-in");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(operationsPassword);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  try {
    await login(page, f.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("link", { name: /Support tickets.*View support queue/ }).click();
    await expect(page).toHaveURL(/\/admin\/support\?status=ACTIVE/);
    await page.goto("/admin/shop/new");
    const sku = `BROWSER-${randomUUID()}`;
    await page.locator('[name="title"]').fill("Synthetic launch bucket");
    await page
      .locator('[name="description"]')
      .fill("Synthetic browser entry; no real inventory");
    await page.locator('[name="sku"]').fill(sku);
    await page.getByLabel("Selling price ($)", { exact: true }).fill("35.00");
    await page.getByLabel("Regular retail price ($)", { exact: true }).fill("50.00");
    await expect(page.getByText("Customer saves $15.00 per item")).toBeVisible();
    await page.screenshot({ path: info.outputPath("shop-entry.png"), fullPage: true });
    await page.getByRole("button", { name: "Save inventory product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[^/]+$/);
    await page.reload();
    await expect(page.locator('[name="name"]').first()).toHaveValue(
      "Synthetic launch bucket",
    );
    const variant = await db.productVariant.findUniqueOrThrow({
      where: { sku },
      include: { prices: true, inventoryBalance: true },
    });
    expect(variant.inventoryBalance).toBeNull();
    expect(variant.prices).toHaveLength(2);
    await page.goto("/admin/settings/launch");
    await expect(
      page.getByRole("heading", { name: "Launch, delivery areas & vehicle capacity" }),
    ).toBeVisible();
    await page.getByLabel("Launch date", { exact: true }).fill("2026-10-15");
    await page.getByLabel("Include orders through", { exact: true }).fill("2026-10-14");
    await page.getByLabel("First delivery by", { exact: true }).fill("2026-10-31");
    await page.getByRole("button", { name: "Save launch & cadence" }).click();
    await expect(page.getByRole("status")).toContainText("Settings saved");
    await page.reload();
    await expect(page.getByLabel("Launch date", { exact: true })).toHaveValue(
      "2026-10-15",
    );
    await page.screenshot({
      path: info.outputPath("launch-calendar-capacity.png"),
      fullPage: true,
    });
    await page.goto("/admin/loyalty");
    const code = `B${randomUUID().replaceAll("-", "").slice(0, 12)}`.toUpperCase();
    await page.locator('[name="code"]').fill(code);
    await page.locator('[name="name"]').fill("Synthetic monthly promotion");
    await page.locator('[name="value"]').fill("10");
    await page.locator('[name="startsOn"]').fill("2026-10-01");
    await page.locator('[name="endsOn"]').fill("2026-10-31");
    await page.getByRole("button", { name: "Save promotion", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Promotion saved");
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(code) })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("loyalty-promotions.png"),
      fullPage: true,
    });
    await login(customer, f.customers[0].email);
    await expect(customer).toHaveURL(/\/account$/);
    const denied = await customer.request.post("/api/admin/promotions", {
      headers: { Origin: "http://localhost:3000" },
      data: {
        code,
        name: "Unauthorized",
        valueType: "PERCENT",
        value: 1000,
        startsOn: "2026-10-01",
        endsOn: "2026-10-31",
        minimumPurchaseCents: 0,
        maximumDiscountCents: null,
        audience: "ALL",
        allowRewards: false,
        isActive: false,
        version: 1,
      },
    });
    expect(denied.status()).toBe(403);
    await customer.goto("/delivery-area");
    await customer.getByLabel("Delivery ZIP").fill("99999");
    await customer.getByRole("button", { name: "Check my area" }).click();
    await expect(customer.getByRole("status")).toContainText("not available");
    await info.attach("database-assertions.json", {
      body: JSON.stringify(
        {
          syntheticOnly: true,
          sku,
          productPricesCents: variant.prices.map((p) => p.amountCents),
          inventoryBalance: null,
          promotion: await db.promotion.findUnique({ where: { code } }),
          customerAdminRequest: denied.status(),
          providerCalls: "NONE",
          checkout: "CLOSED",
          note: "No real payment, tax or email sandbox integration tested.",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await customerContext.close();
    await f.cleanup();
    await db.$disconnect();
  }
});
