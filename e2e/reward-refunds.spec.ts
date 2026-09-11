import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";

test("staff restore original reward-only credit with retry safety and CPA read-only access", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] });
  const marker = randomUUID(),
    password = "Synthetic-Credit-Password-123";
  const users: string[] = [];
  try {
    for (const code of ["ADMIN", "CPA", "CUSTOMER"] as const) {
      const role = await db.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      users.push(
        (
          await db.user.create({
            data: {
              email: `credit-${code}-${marker}@example.test`,
              passwordHash: await bcrypt.hash(password, 4),
              userRoles: { create: { roleId: role.id } },
            },
          })
        ).id,
      );
    }
    const customer = await db.customer.create({ data: { userId: users[2] } });
    const product = await db.product.create({
      data: {
        name: "Synthetic credit return",
        slug: marker,
        brand: "Synthetic",
        variants: {
          create: [
            { name: "Reward item", sku: `reward-${marker}` },
            { name: "Paid item", sku: `cash-${marker}` },
          ],
        },
      },
      include: { variants: true },
    });
    const [credit, cash] = product.variants;
    const order = await db.order.create({
      data: {
        number: `CREDIT-${marker}`,
        customerId: customer.id,
        status: "DELIVERED",
        subtotalCents: 2000,
        discountCents: 1000,
        taxCents: 80,
        totalCents: 1080,
        items: {
          create: [
            {
              productVariantId: credit.id,
              nameSnapshot: "Original reward item",
              skuSnapshot: credit.sku,
              quantity: 2,
              unitPriceCents: 500,
              discountCents: 1000,
              lineTotalCents: 0,
            },
            {
              productVariantId: cash.id,
              nameSnapshot: "Original cash item",
              skuSnapshot: cash.sku,
              quantity: 1,
              unitPriceCents: 1000,
              taxCents: 80,
              lineTotalCents: 1080,
            },
          ],
        },
        checkoutAttempt: {
          create: {
            customerId: customer.id,
            requestKey: randomUUID(),
            requestHash: marker,
            state: "PAID",
            expiresAt: new Date(),
            stripeAccountId: "acct_synthetic",
            livemode: false,
            snapshot: {
              rewardsCents: 1000,
              promotionCents: 0,
              lines: [
                { variantId: credit.id, quantity: 2, discountCents: 1000, netCents: 0 },
                { variantId: cash.id, quantity: 1, discountCents: 0, netCents: 1000 },
              ],
            },
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
    const hold = await db.rewardReservation.create({
      data: {
        orderId: order.id,
        customerId: customer.id,
        requestKey: randomUUID(),
        amountCents: 1000,
        orderTotalCents: 2080,
        state: "USED",
      },
    });
    await db.rewardEntry.create({
      data: {
        customerId: customer.id,
        orderId: order.id,
        sourceId: hold.id,
        entryKey: `order:${order.id}:use`,
        kind: "REDEMPTION",
        amountCents: -1000,
        description: "Synthetic original redemption",
      },
    });
    const login = async (code: string) => {
      await page.goto("/sign-in");
      await page
        .getByLabel("Email", { exact: true })
        .fill(`credit-${code}-${marker}@example.test`);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
      await page.goto(`/admin/orders/${order.id}`);
    };
    await login("ADMIN");
    await page
      .getByRole("button", { name: "Prepare reward credit return", exact: true })
      .click();
    await page
      .getByLabel("Credit return quantity for Original reward item", { exact: true })
      .fill("1");
    await page
      .getByLabel("Credit return reason", { exact: true })
      .fill("Customer returned original reward-funded merchandise");
    await page.getByRole("button", { name: "Review reward credit", exact: true }).click();
    await expect(
      page.getByText("$5.00 reward credit allocated", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: "Restore $5.00 of original reward credit. No cash refund or stock return.",
        exact: true,
      })
      .check();
    const url = `/api/admin/orders/${order.id}/operations`;
    let lost = false;
    await page.route(`**${url}`, async (route) => {
      if (!lost && route.request().postDataJSON().action === "restoreRewardRefund") {
        lost = true;
        const result = await route.fetch();
        expect(result.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "Confirm reward restoration", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page
      .getByRole("button", { name: "Confirm reward restoration", exact: true })
      .click();
    await expect(
      page.getByText("$5.00 reward credit restored", { exact: true }),
    ).toBeVisible();
    await page.unroute(`**${url}`);
    expect(
      await db.refundAdjustment.count({
        where: { request: { orderId: order.id }, kind: "REWARD_ONLY" },
      }),
    ).toBe(1);
    expect(
      await db.rewardEntry.count({ where: { orderId: order.id, kind: "RESTORE" } }),
    ).toBe(1);
    expect(await db.refund.count({ where: { orderId: order.id } })).toBe(0);
    expect(await db.stockReturn.count({ where: { orderId: order.id } })).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("reward-refund.png"), fullPage: true });
    await page.context().clearCookies();
    await login("CPA");
    await expect(
      page.getByRole("button", { name: "Prepare reward credit return", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Confirm reward restoration", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("$5.00 reward credit restored", { exact: true }),
    ).toBeVisible();
  } finally {
    await db.user.updateMany({
      where: { id: { in: users } },
      data: { deletedAt: new Date() },
    });
    await db.$disconnect();
  }
});
