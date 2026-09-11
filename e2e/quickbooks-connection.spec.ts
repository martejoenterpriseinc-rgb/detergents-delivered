import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sealIntegration } from "../lib/integrations/secrets";
import "../tests/integration-guard";
test("QuickBooks intended-company confirmation, failed connection and CPA isolation", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    marker = randomUUID(),
    users: string[] = [],
    key = "integrations:v1:sandbox:quickbooks",
    password = "Synthetic-Qbo-Password-123";
  const original = await db.setting.findUnique({ where: { key } });
  try {
    const values = {
      QUICKBOOKS_CLIENT_ID: "synthetic-browser-client",
      QUICKBOOKS_CLIENT_SECRET: "synthetic-browser-secret",
      QUICKBOOKS_REALM_ID: "123456789",
    };
    const valueJson = {
      version: 1,
      ...sealIntegration({ values, changedAt: {} }, key + ":1"),
    };
    await db.setting.upsert({
      where: { key },
      create: { key, valueJson },
      update: { valueJson },
    });
    for (const code of ["ADMIN", "CPA"] as const) {
      const role = await db.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      const user = await db.user.create({
        data: {
          email: `qbo-${code.toLowerCase()}-${marker}@example.test`,
          passwordHash: await bcrypt.hash(password, 4),
          userRoles: { create: { roleId: role.id } },
        },
      });
      users.push(user.id);
    }
    const login = async (role: string) => {
      await page.goto("/sign-in");
      await page
        .getByLabel("Email", { exact: true })
        .fill(`qbo-${role}-${marker}@example.test`);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
    };
    expect((await page.request.get("/api/admin/quickbooks")).status()).toBe(401);
    await login("admin");
    await page.goto("/admin/reports");
    await page.getByRole("link", { name: "QuickBooks connection", exact: true }).click();
    await expect(page.getByText("Intended company: 123456789")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect to QuickBooks", exact: true }),
    ).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page.route("**/api/admin/quickbooks", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic connection unavailable" }),
      }),
    );
    await page
      .getByRole("button", { name: "Connect to QuickBooks", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic connection unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await page.screenshot({
      path: info.outputPath("quickbooks-connection.png"),
      fullPage: true,
    });
    await page.unroute("**/api/admin/quickbooks");
    const mappingRequests: Array<{ requestKey: string }> = [];
    const mapping = {
      version: 1,
      mode: "sandbox",
      realm: "123456789",
      categoryId: "synthetic-category",
      expenseAccount: {
        id: "1",
        name: "Synthetic supplies",
        type: "Expense",
        currency: "USD",
      },
      paymentAccount: { id: "2", name: "Synthetic bank", type: "Bank", currency: "USD" },
      verifiedAt: new Date().toISOString(),
    };
    await page.route("**/api/admin/quickbooks/accounts*", async (route) => {
      if (route.request().method() === "POST") {
        mappingRequests.push(route.request().postDataJSON());
        return route.fulfill({
          status: mappingRequests.length === 1 ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(
            mappingRequests.length === 1
              ? { error: "Synthetic mapping save interrupted" }
              : mapping,
          ),
        });
      }
      const body = route.request().url().includes("kind=mappings")
        ? {
            canWrite: true,
            realm: "123456789",
            categories: [
              {
                id: "synthetic-category",
                name: "Synthetic supplies category",
                mapping: null,
              },
            ],
          }
        : {
            realm: "123456789",
            accounts: [
              {
                Id: "1",
                Name: "Synthetic supplies",
                AccountType: "Expense",
                Active: true,
                CurrencyRef: { value: "USD" },
              },
              {
                Id: "2",
                Name: "Synthetic bank",
                AccountType: "Bank",
                Active: true,
                CurrencyRef: { value: "USD" },
              },
            ],
            nextStart: null,
          };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page
      .getByRole("button", { name: "Load company accounts", exact: true })
      .click();
    await page
      .getByLabel("Expense category", { exact: true })
      .selectOption("synthetic-category");
    await page
      .getByLabel("QuickBooks expense account", { exact: true })
      .selectOption("1");
    await page.getByLabel("Paid from account", { exact: true }).selectOption("2");
    await expect(
      page.getByRole("button", { name: "Save account mapping", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("I reviewed these accounts for this category and company.")
      .check();
    await page.getByRole("button", { name: "Save account mapping", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic mapping save interrupted" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save account mapping", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved mapping:" }),
    ).toBeVisible();
    expect(mappingRequests).toHaveLength(2);
    expect(mappingRequests[0].requestKey).toBe(mappingRequests[1].requestKey);
    await page.screenshot({
      path: info.outputPath("quickbooks-account-mapping.png"),
      fullPage: true,
    });
    await page.unroute("**/api/admin/quickbooks/accounts*");
    let exportState: Record<string, unknown> | null = null;
    let submitCalls = 0;
    await page.route("**/api/admin/quickbooks/expenses*", async (route) => {
      if (route.request().method() === "POST") {
        const action = route.request().postDataJSON().action;
        if (action === "prepare")
          exportState = {
            id: "qbe_" + "a".repeat(64),
            status: "DRAFT",
            realm: "123456789",
            docNumber: "DD" + "a".repeat(19),
            source: {
              categoryId: "synthetic-category",
              amountCents: 1234,
              currency: "USD",
              date: "2026-09-01",
              memo: "Synthetic export expense",
            },
            mapping,
            externalId: null,
            submittedAt: null,
            confirmedAt: null,
          };
        if (action === "submit") {
          submitCalls++;
          exportState = { ...exportState, status: "UNKNOWN" };
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic submission response lost" }),
          });
        }
        if (action === "reconcile")
          exportState = { ...exportState, status: "POSTED", externalId: "321" };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(exportState),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          canWrite: true,
          canSubmit: true,
          nextCursor: null,
          rows: [
            {
              id: "synthetic-expense",
              date: "2026-09-01",
              category: "Synthetic expense category",
              memo: "Synthetic export expense",
              amountCents: 1234,
              currency: "USD",
              linked: exportState?.status === "POSTED",
              export: exportState,
            },
          ],
        }),
      });
    });
    await page.getByRole("button", { name: "Load expense exports", exact: true }).click();
    await page.getByLabel("I authorize preparing this expense for review.").check();
    await page
      .getByRole("button", { name: "Prepare expense export", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Submit to QuickBooks", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("I reviewed this expense and its QuickBooks accounts.").check();
    await page.getByRole("button", { name: "Submit to QuickBooks", exact: true }).click();
    await expect(
      page.getByText("Reconcile this export before taking further accounting action."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit to QuickBooks", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("I reviewed this expense and its QuickBooks accounts.").check();
    await page.getByRole("button", { name: "Reconcile export", exact: true }).click();
    await expect(
      page.getByText("QuickBooks transaction 321", { exact: true }),
    ).toBeVisible();
    expect(submitCalls).toBe(1);
    await page.screenshot({
      path: info.outputPath("quickbooks-expense-export.png"),
      fullPage: true,
    });
    await page.unroute("**/api/admin/quickbooks/expenses*");
    await page.context().clearCookies();
    await login("cpa");
    await page.goto("/admin/reports/quickbooks?connection=connected");
    await expect(page.getByText("Your accounting access is read-only.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect to QuickBooks", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "QuickBooks authorization was saved. Accounting posting is still off.",
      ),
    ).toHaveCount(0);
    const denied = await page.request.post("/api/admin/quickbooks", {
      headers: { Origin: "http://localhost:3000" },
      data: { action: "connect", confirmed: true },
    });
    expect(denied.status()).toBe(403);
  } finally {
    if (original)
      await db.setting.upsert({
        where: { key },
        create: { key, valueJson: original.valueJson as Prisma.InputJsonValue },
        update: { valueJson: original.valueJson as Prisma.InputJsonValue },
      });
    else await db.setting.deleteMany({ where: { key } });
    await db.user.updateMany({
      where: { id: { in: users } },
      data: { deletedAt: new Date() },
    });
    await db.$disconnect();
  }
});
