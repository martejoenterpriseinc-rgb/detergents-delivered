import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
test("customer consent, private access, revocation and prepared checkout review", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    marker = randomUUID(),
    email = `connection-${marker}@example.test`,
    password = "Synthetic-Connection-123";
  let userId: string | undefined;
  try {
    const role = await db.role.upsert({
      where: { code: "CUSTOMER" },
      update: {},
      create: { code: "CUSTOMER", name: "Customer" },
    });
    const user = await db.user.create({
      data: {
        email,
        emailVerified: new Date(),
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId: role.id } },
        customer: {
          create: {
            firstName: "Synthetic connected household",
            purchaseApprovedAt: new Date(),
          },
        },
      },
      include: { customer: true },
    });
    userId = user.id;
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.getByRole("link", { name: "Connected apps", exact: true }).click();
    await page.getByLabel("Application name").fill("Synthetic shopping helper");
    await expect(page.getByRole("button", { name: "Create access key" })).toBeDisabled();
    await page
      .getByLabel(
        "I authorize this application to use the selected access until expiry or revocation.",
      )
      .check();
    await page.getByRole("button", { name: "Create access key" }).click();
    const key = page.getByLabel("One-time access key");
    await expect(key).toBeVisible();
    const token = await key.inputValue();
    expect(
      (
        await page.request.post("/api/commerce/v1", {
          headers: { authorization: `Bearer ${token}` },
          data: { action: "orders.list" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post("/api/commerce/v1", {
          headers: { authorization: `Bearer ${token}` },
          data: { action: "rewards.balance" },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await page.request.post("/api/commerce/v1", { data: { action: "orders.list" } })
      ).status(),
    ).toBe(401);
    await page.getByRole("button", { name: "Hide access key" }).click();
    await page.reload();
    await expect(page.getByLabel("One-time access key")).toHaveCount(0);
    const card = page.locator("article").filter({ hasText: "Synthetic shopping helper" });
    await expect(card).toContainText("Active");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("commerce-connections.png"),
      fullPage: true,
    });
    await card.getByRole("button", { name: "Revoke connection" }).click();
    await expect(card).toContainText("Access ended");
    expect(
      (
        await page.request.post("/api/commerce/v1", {
          headers: { authorization: `Bearer ${token}` },
          data: { action: "orders.list" },
        })
      ).status(),
    ).toBe(401);
    const id = randomUUID();
    await db.checkoutAttempt.create({
      data: {
        id,
        customerId: user.customer!.id,
        requestKey: id,
        requestHash: "a".repeat(64),
        stripeAccountId: "acct_synthetic",
        livemode: false,
        expiresAt: new Date(Date.now() + 300_000),
        snapshot: {
          input: { addressId: "synthetic" },
          subtotalCents: 1000,
          promotionCents: 0,
          rewardsCents: 0,
          taxCents: 80,
          totalCents: 1080,
          launchDate: "2026-09-20",
          firstDeliveryBy: "2026-09-27",
          address: {
            line1: "100 Synthetic Lane",
            city: "Test City",
            region: "IL",
            postalCode: "60099",
          },
          lines: [
            {
              variantId: "synthetic",
              name: "Synthetic detergent",
              quantity: 1,
              unitPriceCents: 1000,
            },
          ],
        },
      },
    });
    await page.goto(`/checkout/review/${id}`);
    await expect(
      page.getByRole("heading", { name: "Review your prepared order" }),
    ).toBeVisible();
    const pay = page.getByRole("button", { name: "Continue to secure payment" });
    await expect(pay).toBeDisabled();
    await page
      .getByLabel("I accept this delivery window and payment at purchase.")
      .check();
    await page.route(`**/api/checkout/${id}`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic payment unavailable" }),
      }),
    );
    await pay.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic payment unavailable" }),
    ).toBeVisible();
    expect(await db.order.count({ where: { customerId: user.customer!.id } })).toBe(0);
    await page.screenshot({
      path: info.outputPath("prepared-checkout-review.png"),
      fullPage: true,
    });
    await page.unroute(`**/api/checkout/${id}`);
  } finally {
    if (userId)
      await db.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    await db.$disconnect();
  }
});
