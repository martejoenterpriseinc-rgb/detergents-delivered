import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test, expect, type Page } from "@playwright/test";
import { operationsFixture, operationsPassword } from "../tests/operations-fixture";
import { LAUNCH_KEY, launchSchema } from "../lib/domain/launch";
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
      .getByRole("textbox", { name: "Description", exact: true })
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
    const launchDate = page.getByLabel("Launch date", { exact: true });
    const initialDate = await launchDate.inputValue();
    const changedDate = initialDate === "2026-10-19" ? "2026-10-20" : "2026-10-19";
    const beforeLaunch = await db.setting.findUnique({ where: { key: LAUNCH_KEY } });
    const beforeVersion = beforeLaunch
      ? launchSchema.parse(beforeLaunch.valueJson).version
      : 0;
    await launchDate.fill(changedDate);
    await page
      .getByRole("checkbox", {
        name: "Allow ongoing booking after the launch cutoff, starting on launch day",
        exact: true,
      })
      .check();
    await page.getByLabel("Delivery lead time (days)", { exact: true }).fill("3");
    await page.getByLabel("Booking horizon (days)", { exact: true }).fill("35");
    await page.getByLabel("Include orders through", { exact: true }).fill("2026-10-18");
    await page.getByLabel("First delivery by", { exact: true }).fill("2026-10-31");
    await expect(page.getByTestId("saved-launch-date")).toContainText(
      "Unsaved launch changes",
    );
    await page.getByRole("button", { name: "Save launch & cadence" }).click();
    await expect(page.getByRole("status")).toContainText("Settings saved");
    const savedLaunch = await db.setting.findUniqueOrThrow({
      where: { key: LAUNCH_KEY },
    });
    expect(launchSchema.parse(savedLaunch.valueJson)).toMatchObject({
      launchDate: changedDate,
      version: beforeVersion + 1,
      rolling: { enabled: true, leadDays: 3, horizonDays: 35 },
    });
    await page.reload();
    await expect(launchDate).toHaveValue(changedDate);
    await expect(
      page.getByLabel("Delivery lead time (days)", { exact: true }),
    ).toHaveValue("3");
    await expect(page.getByLabel("Booking horizon (days)", { exact: true })).toHaveValue(
      "35",
    );
    await expect(page.getByTestId("saved-launch-date")).toHaveText(
      `Saved launch date: ${changedDate}`,
    );
    // Explicitly mocked network failure: the real database must remain unchanged.
    await page.route("**/api/admin/launch", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic save failure. Please retry." }),
      });
    });
    await launchDate.fill("2026-10-21");
    await page.getByRole("button", { name: "Save launch & cadence" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Synthetic save failure",
    );
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByTestId("saved-launch-date")).toContainText(changedDate);
    const afterFailure = await db.setting.findUniqueOrThrow({
      where: { key: LAUNCH_KEY },
    });
    expect(afterFailure.valueJson).toEqual(savedLaunch.valueJson);
    await page.unroute("**/api/admin/launch");
    await page.reload();
    await expect(launchDate).toHaveValue(changedDate);
    await expect(
      page.getByLabel("Delivery lead time (days)", { exact: true }),
    ).toHaveValue("3");
    await expect(page.getByLabel("Booking horizon (days)", { exact: true })).toHaveValue(
      "35",
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
          launch: {
            initialDate,
            changedDate,
            saved: savedLaunch.valueJson,
            persistedAfterRefresh: true,
            failedSave: "MOCKED HTTP 503",
            databaseUnchangedAfterFailedSave: true,
          },
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
