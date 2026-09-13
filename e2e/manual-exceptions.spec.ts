import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
import { manualPaymentFixture } from "../tests/manual-payment-fixture";
test("manual review keeps the original return request after a lost response", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    password = "Synthetic-Manual-Review-123",
    f = await manualPaymentFixture(db, await bcrypt.hash(password, 4));
  const marker = randomUUID(),
    order = await db.order.create({
      data: {
        number: "REVIEW-" + marker,
        customerId: f.customer.id,
        status: "CANCELLED",
        subtotalCents: 1000,
        totalCents: 1080,
        taxCents: 80,
      },
    });
  const checkout = await db.checkoutAttempt.create({
    data: {
      customerId: f.customer.id,
      requestKey: randomUUID(),
      requestHash: "synthetic",
      state: "EXPIRED",
      snapshot: {},
      orderId: order.id,
      stripeAccountId: "acct_synthetic",
      livemode: false,
      expiresAt: new Date(),
      paymentMethod: "ZELLE",
    },
  });
  const settlement = await db.manualCheckoutSettlement.create({
    data: {
      id: "manual_" + marker,
      checkoutId: checkout.id,
      method: "ZELLE",
      reference: "original-" + marker,
      amountCents: 1080,
      receivedAt: new Date(),
      actorUserId: f.admin.id,
      reason: "Synthetic late receipt",
      approvalId: "synthetic",
      approvalVersion: 1,
      requestHash: "synthetic",
      accountId: "acct_synthetic",
      livemode: false,
      state: "REVIEW",
    },
  });
  const requests: unknown[] = [];
  try {
    expect(
      (await page.request.put("/api/admin/manual-settlements", { data: {} })).status(),
    ).toBe(401);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(f.admin.email!);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/payments/manual");
    const row = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: order.number, exact: true }) });
    await expect(
      row.getByRole("heading", { name: order.number, exact: true }),
    ).toBeVisible();
    await row.getByLabel("Action", { exact: true }).selectOption("RESCHEDULE");
    await expect(row.getByLabel("Agreed delivery date")).toBeVisible();
    await row.getByLabel("Action", { exact: true }).selectOption("RETURN");
    await row.getByLabel("Bank/cash return reference").fill("bank-return-" + marker);
    await row.getByLabel("Review notes").fill("Synthetic bank transfer returned in full");
    await row.getByRole("checkbox").check();
    await page.route("**/api/admin/manual-settlements", async (route) => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) return route.abort("failed");
      return route.fulfill({ json: { id: settlement.id, state: "RETURNED" } });
    });
    await row.getByRole("button", { name: "Save review action", exact: true }).click();
    await expect(row.getByRole("button", { name: "Retry same request" })).toBeVisible();
    await expect(row.getByLabel("Action", { exact: true })).toBeDisabled();
    await row.getByRole("button", { name: "Retry same request" }).click();
    await expect(row.getByRole("status")).toContainText("Review action recorded");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]).toMatchObject({
      id: settlement.id,
      action: "RETURN",
      confirmed: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("manual-exceptions.png"),
      fullPage: true,
    });
  } finally {
    await f.cleanup();
    await db.$disconnect();
  }
});
