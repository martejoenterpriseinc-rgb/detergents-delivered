import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import { operationsFixture, operationsPassword } from "../tests/operations-fixture";
test("address review saves with customer isolation and closed payment gate", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const db = new PrismaClient();
  const f = await operationsFixture(db);
  const zone = await db.deliveryZone.create({
    data: {
      slug: randomUUID(),
      name: "Synthetic browser delivery area",
      boundaryJson: { postalCodes: ["60088"] },
    },
  });
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  const customer = await context.newPage();
  try {
    await customer.goto("/sign-in");
    await customer.getByLabel("Email", { exact: true }).fill(f.customers[0].email);
    await customer.getByLabel("Password", { exact: true }).fill(operationsPassword);
    await customer.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(customer).toHaveURL(/\/account$/);
    await customer.getByRole("link", { name: "Delivery addresses", exact: true }).click();
    await customer
      .getByLabel("Street address", { exact: true })
      .fill("200 Synthetic Browser Lane");
    await customer.getByLabel("City", { exact: true }).fill("Test City");
    await customer.getByLabel("ZIP code", { exact: true }).fill("60088");
    await customer.getByRole("button", { name: "Save address for review" }).click();
    await expect(customer.getByRole("status")).toContainText("Address saved");
    await customer.reload();
    await expect(
      customer.getByText("200 Synthetic Browser Lane", { exact: true }),
    ).toBeVisible();
    const address = await db.address.findFirstOrThrow({
      where: {
        customerId: f.customers[0].customer!.id,
        line1: "200 Synthetic Browser Lane",
      },
    });
    expect(address.validatedAt).toBeNull();
    expect(
      (
        await context.request.post("/api/admin/commerce", {
          headers: { origin: "http://localhost:3000" },
          data: { action: "approveAddress", data: {} },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.post("/api/checkout/quote", {
          headers: { origin: "http://localhost:3000" },
          data: {},
        })
      ).status(),
    ).toBe(503);
    expect(
      (
        await context.request.post("/api/stripe/webhook", {
          data: { type: "checkout.session.completed" },
        })
      ).status(),
    ).toBe(400);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(f.admin.email);
    await page.getByLabel("Password", { exact: true }).fill(operationsPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    // A real review queue can exceed one page. The selected customer's new
    // address must remain discoverable without clearing retained history.
    await db.address.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        customerId: f.customers[1].customer!.id,
        line1: `Queue acceptance ${f.marker} ${i}`,
        city: "Test City",
        region: "IL",
        postalCode: "60088",
        createdAt: new Date("2020-01-01T00:00:00Z"),
      })),
    });
    await page.goto("/admin/customers/approvals");
    await expect(
      page.getByRole("link", { name: "Next page", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Find an address", { exact: true })
      .fill("200 Synthetic Browser Lane");
    await page.getByRole("button", { name: "Search addresses", exact: true }).click();
    const card = page
      .locator("section")
      .filter({ hasText: "200 Synthetic Browser Lane" });
    await card.getByLabel("Verified latitude").fill("42.2");
    await card.getByLabel("Verified longitude").fill("-88.2");
    await card
      .getByLabel("How was the address verified?")
      .fill("Synthetic browser manual verification only");
    await card.getByLabel("I checked the actual address and delivery access.").check();
    await card.getByRole("button", { name: "Approve delivery address" }).click();
    await expect(card).toHaveCount(0);
    await customer.reload();
    await expect(
      customer.getByText("Approved for delivery", { exact: true }),
    ).toBeVisible();
    expect(
      (await db.address.findUniqueOrThrow({ where: { id: address.id } }))
        .validationSource,
    ).toBe("STAFF_REVIEW");
    await page.goto("/admin/payments");
    await expect(
      page.getByRole("heading", { name: "Payments & checkout recovery" }),
    ).toBeVisible();
    await expect(
      page.getByText("Sandbox checkout: closed.", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("payment-recovery-closed.png"),
      fullPage: true,
    });
    await customer.screenshot({
      path: info.outputPath("address-approved.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
    await db.address.deleteMany({
      where: {
        customerId: f.customers[1].customer!.id,
        line1: { startsWith: `Queue acceptance ${f.marker} ` },
      },
    });
    await db.deliveryZone.update({ where: { id: zone.id }, data: { isActive: false } });
    await f.cleanup();
    await db.$disconnect();
  }
});
