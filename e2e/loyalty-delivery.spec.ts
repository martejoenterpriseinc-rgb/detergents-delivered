import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { test, expect, type Page } from "@playwright/test";
import "../tests/integration-guard";
test.use({ actionTimeout: 15000, navigationTimeout: 20000 });
test("owner entry, matched live tiles, referrals and safe checkout rewards preview", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const db = new PrismaClient();
  const marker = randomUUID();
  const password = "Synthetic-Loyalty-Password-123";
  const ownerContext = await browser.newContext({ viewport: page.viewportSize()! });
  const ownerPage = await ownerContext.newPage();
  const friendContext = await browser.newContext({ viewport: page.viewportSize()! });
  const friendPage = await friendContext.newPage();
  const ids: string[] = [];
  async function login(p: Page, email: string) {
    await p.goto("/sign-in");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  try {
    const customerRole = await db.role.upsert({
      where: { code: "CUSTOMER" },
      update: {},
      create: { code: "CUSTOMER", name: "Customer" },
    });
    const adminRole = await db.role.upsert({
      where: { code: "SUPER_ADMIN" },
      update: {},
      create: { code: "SUPER_ADMIN", name: "Owner" },
    });
    async function user(prefix: string, owner = false) {
      const u = await db.user.create({
        data: {
          email: `${prefix.toLowerCase()}-${marker}@example.test`,
          emailVerified: new Date(),
          passwordHash: await bcrypt.hash(password, 4),
          userRoles: {
            create: (owner ? [customerRole.id, adminRole.id] : [customerRole.id]).map(
              (roleId) => ({ roleId }),
            ),
          },
          customer: {
            create: {
              firstName: prefix,
              addresses: {
                create: {
                  line1: `${prefix} Test Road`,
                  city: "Algonquin",
                  region: "IL",
                  postalCode: "60102",
                },
              },
            },
          },
        },
        include: { customer: true },
      });
      ids.push(u.id);
      return u;
    }
    const owner = await user("Owner", true);
    const a = await user("Customer");
    const b = await user("Friend");
    await login(ownerPage, owner.email);
    await expect(ownerPage).toHaveURL(/\/admin$/);
    await ownerPage.getByRole("link", { name: "View as customer", exact: true }).click();
    await expect(ownerPage).toHaveURL(/\/account$/);
    await expect(ownerPage.getByText(owner.email, { exact: true })).toBeVisible();
    await ownerPage.getByRole("link", { name: "Admin / Owner", exact: true }).click();
    await expect(ownerPage).toHaveURL(/\/admin$/);
    expect(await db.userRole.count({ where: { userId: owner.id } })).toBe(2);
    await ownerPage
      .getByRole("navigation", { name: "Admin navigation" })
      .getByRole("link", { name: "Customers", exact: true })
      .click();
    await ownerPage
      .getByRole("navigation", { name: "Workspace tools" })
      .getByRole("link", { name: "Loyalty program", exact: true })
      .click();
    await ownerPage.getByLabel("Enable new referrals").check();
    await ownerPage.getByLabel("Referrer reward ($)", { exact: true }).fill("50.00");
    await ownerPage
      .getByLabel("Friend reward after first purchase ($)", { exact: true })
      .fill("5.00");
    await ownerPage
      .getByLabel("Minimum merchandise purchase ($)", { exact: true })
      .fill("35.00");
    await ownerPage.getByRole("button", { name: "Save program settings" }).click();
    await expect(ownerPage.getByRole("status")).toContainText("Program settings saved");
    await ownerPage.reload();
    await expect(
      ownerPage.getByLabel("Referrer reward ($)", { exact: true }),
    ).toHaveValue("50.00");
    await ownerPage.screenshot({
      path: info.outputPath("loyalty-admin.png"),
      fullPage: true,
    });
    await login(page, a.email);
    await expect(page).toHaveURL(/\/account$/);
    expect(
      (
        await page.request.patch("/api/admin/loyalty", {
          headers: { origin: "http://localhost:3000" },
          data: {
            ...(await db.loyaltyProgram.findUniqueOrThrow({ where: { id: "default" } })),
            id: undefined,
            updatedAt: undefined,
          },
        })
      ).status(),
    ).toBe(403);
    await page.getByRole("link", { name: /Loyalty Club/ }).click();
    await page.getByLabel("Label for your records").fill(`Neighbor ${marker}`);
    await page.getByRole("button", { name: "Create referral link" }).click();
    await expect(page.getByRole("status")).toContainText("Referral link created");
    const link = await db.referralLink.findFirstOrThrow({
      where: { customerId: a.customer!.id },
    });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Link copied");
    expect(
      (await db.referralLink.findUniqueOrThrow({ where: { id: link.id } })).copiedAt,
    ).not.toBeNull();
    await login(friendPage, b.email);
    await expect(friendPage).toHaveURL(/\/account$/);
    const privateView = await friendPage.request.get("/api/account/loyalty");
    expect((await privateView.json()).links).toHaveLength(0);
    await friendPage.goto(`/r/${link.token}`);
    await friendPage.getByRole("button", { name: "Claim referral" }).click();
    await expect(friendPage.getByRole("status")).toContainText("Referral linked");
    const referral = await db.referral.findUniqueOrThrow({
      where: { refereeId: b.customer!.id },
    });
    await ownerPage.goto(`/admin/loyalty/referrals?status=PENDING&q=${referral.id}`);
    await ownerPage.getByRole("button", { name: "Review qualifying purchase" }).click();
    await expect(
      ownerPage.getByRole("alert").filter({ hasText: "No qualifying paid first order" }),
    ).toBeVisible();
    // Fixture only: verifiedAt simulates the future trusted provider adapter. This is NOT a real Stripe sandbox charge.
    const qualifying = await db.order.create({
      data: {
        number: `QUALIFY-${marker}`,
        customerId: b.customer!.id,
        status: "PAID",
        subtotalCents: 3500,
        totalCents: 3500,
        payments: {
          create: {
            status: "CAPTURED",
            amountCents: 3500,
            externalId: `synthetic-pi-${marker}`,
            events: {
              create: {
                type: "payment_intent.succeeded",
                externalId: `synthetic-evt-${marker}`,
                verifiedAt: new Date(),
              },
            },
          },
        },
      },
    });
    await ownerPage.getByRole("button", { name: "Review qualifying purchase" }).click();
    await expect
      .poll(() =>
        db.rewardEntry.count({ where: { customerId: a.customer!.id, kind: "REFERRAL" } }),
      )
      .toBe(1);
    await ownerPage.getByLabel("Status", { exact: true }).selectOption("REWARDED");
    await ownerPage.getByLabel("Sort", { exact: true }).selectOption("oldest");
    await ownerPage.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(ownerPage.getByLabel("Sort", { exact: true })).toHaveValue("oldest");
    const csvUrl = await ownerPage
      .getByRole("link", { name: "Export filtered CSV" })
      .getAttribute("href");
    const referralCsv = await ownerPage.request.get(csvUrl!);
    expect(referralCsv.status()).toBe(200);
    const referralText = await referralCsv.text();
    expect(referralText).toContain(referral.id);
    expect(referralText).toContain(b.email);
    expect(referralText).toContain("REWARDED");
    expect(referralText.split("\r\n")).toHaveLength(2);
    expect((await page.request.get(csvUrl!)).status()).toBe(403);
    const rewardCsv = await ownerPage.request.get(
      `/api/admin/loyalty/export?scope=rewards&kind=REFERRAL&q=${encodeURIComponent(a.email)}&sort=oldest`,
    );
    expect(rewardCsv.status()).toBe(200);
    const rewardText = await rewardCsv.text();
    expect(rewardText).toContain(a.email);
    expect(rewardText).toContain('"5000"');
    expect(rewardText).not.toContain(b.email);
    expect(rewardText.split("\r\n")).toHaveLength(2);
    await page.reload();
    await expect(page.getByTestId("reward-balance")).toHaveText("$50.00");
    await expect(page.getByText("Reward earned", { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("loyalty-customer.png"),
      fullPage: true,
    });
    const order = await db.order.create({
      data: {
        number: `DELIVERY-${marker}`,
        customerId: a.customer!.id,
        status: "FULFILLING",
        totalCents: 1200,
      },
    });
    await page.goto("/account");
    await expect(page.getByTestId("delivery-widget")).toContainText(
      "Preparing your delivery",
    );
    const d = await page.getByTestId("delivery-widget").boundingBox();
    const l = await page.getByTestId("loyalty-widget").boundingBox();
    expect(d?.height).toBe(l?.height);
    expect(d?.width).toBe(l?.width);
    await db.order.update({
      where: { id: order.id },
      data: { status: "OUT_FOR_DELIVERY" },
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("delivery-widget")).toContainText("Out for delivery");
    await db.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
    // No manual reload/focus: prove the normal 15-second refresh interval.
    await expect(page.getByTestId("delivery-widget")).toContainText(
      "Delivery completed",
      { timeout: 22000 },
    );
    await expect(
      page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Orders & delivery updates" }) })
        .getByText("Delivery completed", { exact: true }),
    ).toBeVisible();
    await page.route("**/api/account/delivery-status", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Synthetic unavailable response"}',
      }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("delivery-widget")).toContainText(
      "Updates unavailable",
    );
    await page.unroute("**/api/account/delivery-status");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("delivery-widget")).toContainText(
      "Auto-updates every 15 seconds",
    );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("account-live-tiles.png"),
      fullPage: true,
    });
    const product = await db.product.create({
      data: {
        name: "Synthetic detergent",
        brand: "Synthetic",
        slug: marker,
        websiteVisible: true,
        variants: {
          create: {
            name: "Bucket",
            sku: marker,
            websiteVisible: true,
            prices: { create: { amountCents: 1200, startsAt: new Date(0) } },
          },
        },
      },
      include: { variants: true },
    });
    await page.evaluate(
      ({ variantId, productId }) => {
        localStorage.setItem(
          "dd-cart-v1",
          JSON.stringify({
            lines: [
              {
                variantId,
                productId,
                slug: "synthetic",
                productName: "Synthetic detergent",
                variantName: "Bucket",
                sku: "synthetic",
                brand: "Synthetic",
                sizeLabel: null,
                scent: null,
                unitPriceCents: 1200,
                quantity: 1,
                imageId: null,
              },
            ],
            updatedAt: new Date().toISOString(),
          }),
        );
      },
      { variantId: product.variants[0].id, productId: product.id },
    );
    await page.goto("/checkout");
    await page.getByRole("button", { name: "Apply rewards", exact: true }).click();
    const rewardsNotice = page
      .getByRole("status")
      .filter({ hasText: "Rewards preview:" });
    await expect(rewardsNotice).toContainText("$12.00 would apply");
    await expect(rewardsNotice).toContainText("$38.00 would remain");
    await expect(rewardsNotice).toContainText("No rewards have been used");
    await expect(
      page.getByRole("button", { name: "Checkout not available yet" }),
    ).toBeDisabled();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("checkout-rewards-preview.png"),
      fullPage: true,
    });
    expect(
      await db.rewardReservation.count({ where: { customerId: a.customer!.id } }),
    ).toBe(0);
    expect(
      (
        await db.rewardEntry.aggregate({
          where: { customerId: a.customer!.id },
          _sum: { amountCents: true },
        })
      )._sum.amountCents,
    ).toBe(5000);
    expect(await db.order.findUnique({ where: { id: qualifying.id } })).toEqual(
      qualifying,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await info.attach("loyalty-database-assertions", {
      body: JSON.stringify({
        ownerDefaultAdmin: true,
        customerViewSameIdentity: true,
        rolesPreserved: true,
        customerIsolation: true,
        filteredCsvAndAdminOnlyExport: true,
        liveStatusPolling: true,
        orderListRefreshesWithStatus: true,
        failedPollRecovery: true,
        matchingTileSizes: true,
        referralCreditCents: 5000,
        previewUsesAuthoritativePriceCents: 1200,
        previewRemainingCents: 3800,
        actualWalletUnchanged: true,
        providerEvidence:
          "Synthetic persisted verified payment fixture; no real Stripe sandbox call",
        checkout: "Blocked pending payment/tax/stock/capacity integration",
      }),
      contentType: "application/json",
    });
  } finally {
    await db.user.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });
    await ownerContext.close();
    await friendContext.close();
    await db.$disconnect();
  }
});
