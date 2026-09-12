import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
import { receiptFixture } from "../tests/customer-receipt-fixture";

test("household reprints its original receipt and saves a private PDF without changing the purchase", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] });
  const password = "Synthetic-Receipt-Password-123";
  const fixtures: Awaited<ReturnType<typeof receiptFixture>>[] = [];
  try {
    const f = await receiptFixture(db, { passwordHash: await bcrypt.hash(password, 4) });
    fixtures.push(f);
    const other = await receiptFixture(db);
    fixtures.push(other);
    await page.goto(`/receipts/${f.checkoutId}`);
    await expect(page).toHaveURL(/\/sign-in/);
    await page.getByLabel("Email", { exact: true }).fill(f.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/sign-in/);
    await page.goto(`/checkout/receipt/${f.checkoutId}`);
    await page
      .getByRole("link", { name: "Print or save your original receipt", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Original order receipt", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("TEST RECEIPT — Not a live purchase", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Original detergent bucket", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Unit 2", { exact: false })).toBeVisible();
    await expect(page.getByText("$22.68", { exact: true })).toHaveCount(2);
    await expect(page.getByText("-$6.00", { exact: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(
      /private-snapshot|private-tax|private-vehicle|pi_private|Current catalog/,
    );
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset.printRequested = "true";
      };
    });
    await page.getByRole("button", { name: "Print or save PDF", exact: true }).click();
    expect(await page.locator("html").getAttribute("data-print-requested")).toBe("true");
    await page.reload();
    await expect(page.getByText("Original payment", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("original-receipt.png"),
      fullPage: true,
    });
    await page.emulateMedia({ media: "print" });
    await expect(
      page.getByRole("button", { name: "Print or save PDF", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("link", { name: "Contact support", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByText("TEST RECEIPT — Not a live purchase", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("original-receipt-print.png"),
      fullPage: true,
    });
    if (info.project.name === "desktop") {
      const pdf = await page.pdf({
        path: info.outputPath("original-receipt.pdf"),
        format: "A4",
        printBackground: true,
      });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }
    await page.emulateMedia({ media: "screen" });
    const denied = await page.goto(`/receipts/${other.checkoutId}`);
    expect(denied?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Original order receipt", exact: true }),
    ).toHaveCount(0);
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: f.orderId } })).totalCents,
    ).toBe(2268);
    expect(await db.payment.count({ where: { orderId: f.orderId } })).toBe(1);
    expect(await db.refundRequest.count({ where: { orderId: f.orderId } })).toBe(0);
  } finally {
    await db.user.updateMany({
      where: { id: { in: fixtures.map((f) => f.userId) } },
      data: { deletedAt: new Date() },
    });
    await db.product.updateMany({
      where: { id: { in: fixtures.map((f) => f.productId) } },
      data: { isActive: false, websiteVisible: false },
    });
    await db.$disconnect();
  }
});
