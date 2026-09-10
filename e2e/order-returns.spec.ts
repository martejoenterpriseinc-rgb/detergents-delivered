import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";

test("staff receive goods, recover a lost response and cancel only unused refund drafts", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] });
  const marker = randomUUID(),
    password = "Synthetic-Return-Password-123";
  const users: string[] = [];
  let productId: string | undefined;
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
              email: `return-${code.toLowerCase()}-${marker}@example.test`,
              passwordHash: await bcrypt.hash(password, 4),
              userRoles: { create: { roleId: role.id } },
            },
          })
        ).id,
      );
    }
    const customer = await db.customer.create({
      data: { userId: users[2], firstName: "Synthetic returns" },
    });
    const product = await db.product.create({
      data: {
        name: "Synthetic product",
        slug: marker,
        brand: "Synthetic",
        variants: { create: { name: "Bucket", sku: marker } },
      },
      include: { variants: true },
    });
    productId = product.id;
    const variant = product.variants[0].id;
    await db.inventoryBalance.create({ data: { productVariantId: variant } });
    const layer = await db.inventoryCostLayer.create({
      data: {
        productVariantId: variant,
        quantityOriginal: 3,
        quantityRemaining: 0,
        landedUnitCostCents: 400,
      },
    });
    const order = await db.order.create({
      data: {
        number: `RETURN-${marker}`,
        customerId: customer.id,
        status: "DELIVERED",
        subtotalCents: 3000,
        taxCents: 240,
        totalCents: 3240,
        items: {
          create: {
            productVariantId: variant,
            nameSnapshot: "Original detergent bucket",
            skuSnapshot: marker,
            quantity: 3,
            unitPriceCents: 1000,
            taxCents: 240,
            lineTotalCents: 3240,
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
            costs: {
              create: {
                costLayerId: layer.id,
                quantity: 3,
                unitCostCents: 400,
                state: "CONSUMED",
              },
            },
          },
        },
      },
      include: { items: true },
    });
    const payment = await db.payment.create({
      data: {
        orderId: order.id,
        provider: "STRIPE",
        status: "CAPTURED",
        amountCents: 3240,
      },
    });
    const draft = await db.refundRequest.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        actorUserId: users[0],
        requestKey: randomUUID(),
        requestHash: `private-${marker}`,
        amountCents: 1080,
        currency: "USD",
        reason: "Customer asked to review a refund",
        providerAccountId: "acct_synthetic",
        livemode: false,
        lines: {
          create: {
            orderItemId: order.items[0].id,
            quantity: 1,
            netCents: 1000,
            taxCents: 80,
            rewardCents: 0,
          },
        },
        events: { create: { type: "refund.prepared", status: "PREPARED" } },
      },
    });
    await db.refundRequest.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        actorUserId: users[0],
        requestKey: randomUUID(),
        requestHash: `private-${marker}`,
        amountCents: 1080,
        currency: "USD",
        reason: "Earlier refund needs provider reconciliation",
        providerAccountId: "acct_synthetic",
        providerRefundId: `re_private_${marker}`,
        livemode: false,
        status: "UNKNOWN",
        submittedAt: new Date(),
      },
    });
    const url = `/api/admin/orders/${order.id}/operations`;
    const payload = {
      action: "receiveReturn",
      confirmed: true,
      data: {
        orderId: order.id,
        requestKey: randomUUID(),
        reason: "Physically received unopened goods",
        lines: [{ orderItemId: order.items[0].id, quantity: 1, condition: "SELLABLE" }],
      },
    };
    expect((await page.request.post(url, { data: payload })).status()).toBe(401);
    const login = async (code: string) => {
      await page.goto("/sign-in");
      await page
        .getByLabel("Email", { exact: true })
        .fill(`return-${code.toLowerCase()}-${marker}@example.test`);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
    };
    await login("ADMIN");
    expect(
      (
        await page.request.post(url, {
          headers: { Origin: "https://wrong.example.test" },
          data: payload,
        })
      ).status(),
    ).toBe(403);
    await page.goto(`/admin/orders/${order.id}`);
    await expect(page.getByText("Needs reconciliation", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel refund draft", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Cancel refund draft", exact: true }).click();
    await page
      .getByLabel("Cancellation reason", { exact: true })
      .fill("Customer decided to keep this refund draft unused");
    await page
      .getByRole("button", { name: "Confirm draft cancellation", exact: true })
      .click();
    await expect(page.getByText("Canceled", { exact: true })).toBeVisible();
    expect(
      (await db.refundRequest.findUniqueOrThrow({ where: { id: draft.id } })).status,
    ).toBe("CANCELED");
    await page
      .getByRole("button", { name: "Receive returned goods", exact: true })
      .click();
    await page
      .getByLabel("Quantity for Original detergent bucket", { exact: true })
      .fill("1");
    await page
      .getByLabel("Condition for Original detergent bucket", { exact: true })
      .selectOption("DAMAGED");
    await page
      .getByLabel("Return reason", { exact: true })
      .fill("Leaking bucket was physically received and inspected");
    await page
      .getByRole("checkbox", {
        name: "I received these goods and checked their condition.",
      })
      .check();
    let intercepted = false;
    await page.route(`**${url}`, async (route) => {
      if (!intercepted) {
        intercepted = true;
        const saved = await route.fetch();
        expect(saved.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Save received return", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Retry same receipt", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Return reason", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Retry same receipt", exact: true }).click();
    await expect(
      page.getByText("Return received and inventory updated.", { exact: true }),
    ).toBeVisible();
    expect(await db.stockReturn.count({ where: { orderId: order.id } })).toBe(1);
    await page.unroute(`**${url}`);
    await page.reload();
    await expect(page.getByText("Damaged stock", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Receive returned goods", exact: true })
      .click();
    await expect(page.getByText("2 remaining to return", { exact: true })).toBeVisible();
    await page
      .getByLabel("Quantity for Original detergent bucket", { exact: true })
      .fill("1");
    await page
      .getByLabel("Return reason", { exact: true })
      .fill("Unopened bucket physically received in sellable condition");
    await page
      .getByRole("checkbox", {
        name: "I received these goods and checked their condition.",
      })
      .check();
    await page.getByRole("button", { name: "Save received return", exact: true }).click();
    await expect(
      page.getByText("Return received and inventory updated.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("order-returns.png"), fullPage: true });
    const result = await page.request.get(`/api/admin/orders/${order.id}`);
    expect(await result.text()).not.toContain(`private-${marker}`);
    expect(await db.refund.count({ where: { orderId: order.id } })).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "DELIVERED",
    );
    expect(
      await db.inventoryBalance.findUniqueOrThrow({
        where: { productVariantId: variant },
      }),
    ).toMatchObject({ onHandQty: 1, damagedQty: 1 });
    await page.context().clearCookies();
    await login("CPA");
    await page.goto(`/admin/orders/${order.id}`);
    await expect(page.getByText("Damaged stock", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Receive returned goods", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.post(url, {
          headers: { Origin: "http://localhost:3000" },
          data: payload,
        })
      ).status(),
    ).toBe(403);
  } finally {
    if (productId)
      await db.product.update({
        where: { id: productId },
        data: { isActive: false, websiteVisible: false },
      });
    await db.user.updateMany({
      where: { id: { in: users } },
      data: { deletedAt: new Date() },
    });
    await db.$disconnect();
  }
});
