import { businessDate } from "../lib/domain/operations";
import { quarterDate } from "../lib/domain/subscriptions";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { subscriptionConsent } from "../lib/domain/subscriptions";
import "../tests/integration-guard";

test("household quarterly consent, lost-save retry, pause, skip, resume and cancel", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const db = new PrismaClient({ log: [] }),
    marker = randomUUID(),
    password = "Synthetic-Quarterly-Password-123";
  let userId: string | undefined;
  try {
    const role = await db.role.upsert({
      where: { code: "CUSTOMER" },
      update: {},
      create: { code: "CUSTOMER", name: "Customer" },
    });
    const user = await db.user.create({
      data: {
        email: `quarterly-${marker}@example.test`,
        emailVerified: new Date(),
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId: role.id } },
        customer: { create: { purchaseApprovedAt: new Date() } },
      },
      include: { customer: true },
    });
    userId = user.id;
    const customer = user.customer!;
    const address = await db.address.create({
      data: {
        customerId: customer.id,
        line1: "1 Synthetic Way",
        city: "Algonquin",
        region: "IL",
        postalCode: "60102",
        country: "US",
      },
    });
    const product = await db.product.create({
      data: {
        name: "Quarterly detergent",
        slug: marker,
        brand: "Synthetic",
        variants: { create: { name: "Bucket", sku: marker } },
      },
      include: { variants: true },
    });
    const order = await db.order.create({
      data: {
        number: `QUARTER-${marker}`,
        customerId: customer.id,
        addressId: address.id,
        status: "DELIVERED",
        subtotalCents: 1000,
        taxCents: 80,
        totalCents: 1080,
        items: {
          create: {
            productVariantId: product.variants[0].id,
            nameSnapshot: "Original detergent",
            skuSnapshot: marker,
            quantity: 1,
            unitPriceCents: 1000,
            taxCents: 80,
            lineTotalCents: 1080,
          },
        },
        checkoutAttempt: {
          create: {
            customerId: customer.id,
            requestKey: marker,
            requestHash: marker,
            state: "PAID",
            snapshot: {},
            expiresAt: new Date(),
            stripeAccountId: "acct_synthetic",
            livemode: false,
          },
        },
      },
      include: { checkoutAttempt: true },
    });
    await db.payment.create({
      data: {
        orderId: order.id,
        provider: "STRIPE",
        status: "CAPTURED",
        amountCents: 1080,
        externalId: `pi_${marker.replaceAll("-", "")}`,
        events: {
          create: {
            type: "checkout.session.completed",
            externalId: `checkout:${order.checkoutAttempt!.id}:paid`,
            verifiedAt: new Date(),
          },
        },
      },
    });
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.goto("/account/subscriptions");
    await page.getByRole("checkbox", { name: subscriptionConsent, exact: true }).check();
    let lost = false;
    await page.route("**/api/account/subscriptions", async (route) => {
      if (!lost && route.request().method() === "POST") {
        lost = true;
        const r = await route.fetch();
        expect(r.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "Start quarterly subscription", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry same subscription change", exact: true })
      .click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await page.unroute("**/api/account/subscriptions");
    expect(await db.subscription.count({ where: { customerId: customer.id } })).toBe(1);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Confirm pause", exact: true }).click();
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.getByRole("button", { name: "Confirm resume", exact: true }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Skip next quarter", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirm skip next quarter", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await db.subscription.findFirstOrThrow({ where: { customerId: customer.id } }))
            .cycleNumber,
      )
      .toBe(2);
    await page.reload();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("quarterly-subscriptions.png"),
      fullPage: true,
    });
    const sub = await db.subscription.findFirstOrThrow({
      where: { customerId: customer.id },
    });
    const past = new Date(businessDate());
    past.setUTCFullYear(past.getUTCFullYear() - 1);
    await db.subscription.update({
      where: { id: sub.id },
      data: {
        anchorDate: past,
        nextOrderAt: new Date(
          quarterDate(past.toISOString().slice(0, 10), sub.cycleNumber),
        ),
      },
    });
    await page.reload();
    await page.getByRole("button", { name: "Review this quarter", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Review your quarterly purchase", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Ordering is not open right now.", { exact: false }),
    ).toBeVisible();
    await page.reload();
    expect(await db.subscriptionCycle.count({ where: { subscriptionId: sub.id } })).toBe(
      1,
    );
    await page.screenshot({
      path: info.outputPath("quarterly-cycle-review.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: "Back to subscriptions", exact: true }).click();
    await page.getByRole("button", { name: "Cancel subscription", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirm cancel subscription", exact: true })
      .click();
    await expect(page.getByText("Canceled", { exact: true })).toBeVisible();
    expect(await db.order.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
  } finally {
    if (userId)
      await db.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    await db.$disconnect();
  }
});
