import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";

test("staff can find historical orders while CPA access stays read only", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] });
  const marker = randomUUID(),
    password = "Synthetic-Order-Password-123";
  const users: string[] = [];
  let customer: string | undefined,
    product: string | undefined,
    variant: string | undefined;
  try {
    for (const code of ["ADMIN", "CPA", "CUSTOMER"] as const) {
      const role = await db.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      const user = await db.user.create({
        data: {
          email: `${code}-${marker}@example.test`,
          passwordHash: await bcrypt.hash(password, 4),
          userRoles: { create: { roleId: role.id } },
        },
      });
      users.push(user.id);
    }
    customer = (
      await db.customer.create({
        data: { userId: users[2], firstName: "Synthetic household", lastName: marker },
      })
    ).id;
    const p = await db.product.create({
      data: {
        name: "Renamed catalog product",
        brand: "Synthetic",
        slug: marker,
        variants: { create: { name: "Current label", sku: marker } },
      },
      include: { variants: true },
    });
    product = p.id;
    variant = p.variants[0].id;
    const order = await db.order.create({
      data: {
        number: `ORDER-${marker}`,
        customerId: customer,
        status: "PENDING_PAYMENT",
        totalCents: 1080,
        subtotalCents: 1000,
        taxCents: 80,
        items: {
          create: {
            productVariantId: p.variants[0].id,
            nameSnapshot: "Original detergent name at purchase",
            skuSnapshot: `SOLD-${marker}`,
            quantity: 1,
            unitPriceCents: 1000,
            taxCents: 80,
            lineTotalCents: 1080,
          },
        },
        checkoutAttempt: {
          create: {
            customerId: customer,
            requestKey: marker,
            requestHash: marker,
            state: "REVIEW",
            snapshot: {},
            expiresAt: new Date(),
            stripeSessionId: `cs_synthetic_${marker}`,
            stripeAccountId: "acct_synthetic",
            livemode: false,
          },
        },
      },
    });
    const login = async (code: string) => {
      await page.goto("/sign-in");
      await page
        .getByLabel("Email", { exact: true })
        .fill(`${code}-${marker}@example.test`);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
    };
    expect((await page.request.get(`/api/admin/orders/${order.id}`)).status()).toBe(401);
    await login("ADMIN");
    await page.goto("/admin/orders");
    await page.getByLabel("Search orders", { exact: true }).fill(marker);
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText("10.80 USD");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("orders.png"), fullPage: true });
    await page.getByRole("link", { name: "View order", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Original detergent name at purchase",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Recheck with Stripe", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "No payment record. Do not treat the order total as collected funds.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: order.number, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("order-detail.png"), fullPage: true });
    const response = await page.request.get(`/api/admin/orders/${order.id}`);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.text()).not.toContain(`cs_synthetic_${marker}`);
    expect(
      (
        await page.request.post(`/api/admin/orders/${order.id}`, {
          data: { status: "PAID" },
        })
      ).status(),
    ).toBe(405);
    await page.goto("/admin/orders?status=invalid");
    await expect(
      page.getByRole("link", { name: "Reset filters", exact: true }),
    ).toBeVisible();
    await page.context().clearCookies();
    await login("CPA");
    await page.goto(`/admin/orders/${order.id}`);
    await expect(
      page.getByRole("heading", { name: order.number, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Recheck with Stripe", exact: true }),
    ).toHaveCount(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "PENDING_PAYMENT",
    );
  } finally {
    if (customer) {
      await db.orderItem.deleteMany({ where: { order: { customerId: customer } } });
      await db.checkoutAttempt.deleteMany({ where: { customerId: customer } });
      await db.order.deleteMany({ where: { customerId: customer } });
      await db.customer.delete({ where: { id: customer } });
    }
    if (variant) await db.productVariant.delete({ where: { id: variant } });
    if (product) await db.product.delete({ where: { id: product } });
    await db.userRole.deleteMany({ where: { userId: { in: users } } });
    await db.user.updateMany({
      where: { id: { in: users } },
      data: { deletedAt: new Date() },
    });
    await db.$disconnect();
  }
});
