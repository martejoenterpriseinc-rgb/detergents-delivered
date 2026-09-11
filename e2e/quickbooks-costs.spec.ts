import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
test("cost accounting preserves failed choices and distinguishes original sale from restored inventory", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    marker = randomUUID(),
    password = "Synthetic-Cost-Review-123";
  const role = await db.role.upsert({
    where: { code: "ADMIN" },
    update: {},
    create: { code: "ADMIN", name: "Admin" },
  });
  const user = await db.user.create({
    data: {
      email: "cost-review-" + marker + "@example.test",
      passwordHash: await bcrypt.hash(password, 4),
      userRoles: { create: { roleId: role.id } },
    },
  });
  const mapping = {
    version: 1,
    mode: "sandbox",
    realm: "123456789",
    costAccount: {
      id: "11",
      name: "Synthetic cost of goods",
      type: "Cost of Goods Sold",
      currency: "USD",
    },
    inventoryAccount: {
      id: "12",
      name: "Synthetic inventory asset",
      type: "Other Current Asset",
      currency: "USD",
    },
    verifiedAt: new Date().toISOString(),
  };
  const requests: Array<{ requestKey: string }> = [];
  try {
    expect((await page.request.get("/api/admin/quickbooks/costs")).status()).toBe(401);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(user.email!);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.route("**/api/admin/quickbooks/accounts*", (route) =>
      route.fulfill({
        json: {
          realm: mapping.realm,
          accounts: [
            {
              Id: "11",
              Name: mapping.costAccount.name,
              AccountType: "Cost of Goods Sold",
              Active: true,
              CurrencyRef: { value: "USD" },
            },
            {
              Id: "12",
              Name: mapping.inventoryAccount.name,
              AccountType: "Other Current Asset",
              Active: true,
              CurrencyRef: { value: "USD" },
            },
          ],
          nextStart: null,
        },
      }),
    );
    await page.route("**/api/admin/quickbooks/costs*", (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (request.method() === "POST") {
        requests.push(request.postDataJSON());
        return route.fulfill({
          status: requests.length === 1 ? 503 : 200,
          json:
            requests.length === 1
              ? { error: "Synthetic cost mapping interrupted" }
              : mapping,
        });
      }
      if (url.searchParams.get("kind") === "orders")
        return route.fulfill({
          json: {
            nextCursor: null,
            rows: [
              {
                id: "order-fixture",
                number: "Synthetic cost order",
                date: "2026-02-01T18:00:00Z",
                returns: [{ id: "return-fixture", date: "2026-02-02T18:00:00Z" }],
                moreReturns: false,
              },
            ],
          },
        });
      if (url.searchParams.get("kind") === "source") {
        const returned = url.searchParams.has("returnId");
        return route.fulfill({
          json: {
            kind: returned ? "RETURN" : "SALE",
            orderId: "order-fixture",
            number: "Synthetic cost order",
            sourceId: returned ? "return-fixture" : "order-fixture",
            date: "2026-02-01",
            currency: "USD",
            amountCents: returned ? 400 : 1500,
            pieces: [
              {
                allocationId: "synthetic",
                costLayerId: "synthetic",
                quantity: returned ? 1 : 3,
                unitCostCents: returned ? 400 : 500,
              },
            ],
          },
        });
      }
      return route.fulfill({
        json: { canWrite: true, realm: mapping.realm, mapping: null },
      });
    });
    await page.goto("/admin/reports/quickbooks");
    await page.getByRole("button", { name: "Load cost accounts", exact: true }).click();
    await page
      .getByLabel("Cost of goods sold account", { exact: true })
      .selectOption("11");
    await page.getByLabel("Inventory asset account", { exact: true }).selectOption("12");
    await page
      .getByLabel("I reviewed these cost and inventory accounts for this company.")
      .check();
    await page.getByRole("button", { name: "Save cost mapping", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic cost mapping interrupted" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Cost of goods sold account", { exact: true }),
    ).toHaveValue("11");
    await page.getByRole("button", { name: "Save cost mapping", exact: true }).click();
    await expect(
      page.getByText(
        "Saved cost mapping: Synthetic cost of goods · Synthetic inventory asset.",
      ),
    ).toBeVisible();
    expect(requests[0].requestKey).toBe(requests[1].requestKey);
    await page
      .getByRole("button", { name: "Load paid orders for cost review", exact: true })
      .click();
    await page.getByLabel("Paid order", { exact: true }).selectOption("order-fixture");
    await page.getByRole("button", { name: "Review recorded cost", exact: true }).click();
    await expect(page.getByText("$15.00 · 2026-02-01", { exact: true })).toBeVisible();
    await page.getByLabel("Cost source", { exact: true }).selectOption("return-fixture");
    await expect(page.getByText("$15.00 · 2026-02-01", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Review recorded cost", exact: true }).click();
    await expect(page.getByText("$4.00 · 2026-02-01", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Damaged goods do not restore the inventory asset balance.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("quickbooks-cost-review.png"),
      fullPage: true,
    });
  } finally {
    await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    await db.$disconnect();
  }
});
