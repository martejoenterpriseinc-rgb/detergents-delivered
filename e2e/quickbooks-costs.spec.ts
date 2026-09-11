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
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("quickbooks-cost-review.png"),
      fullPage: true,
    });

    let journalStatus = "DRAFT",
      prepared = false,
      sends = 0;
    const journalId = "qbc_" + "a".repeat(64),
      docNumber = "DC" + "a".repeat(19);
    await page.route("**/api/admin/quickbooks/journals*", (route) => {
      const r = route.request();
      const journal = () => ({
        id: journalId,
        status: journalStatus,
        realm: mapping.realm,
        docNumber,
        mapping,
        source: {
          kind: "RETURN",
          orderId: "order-fixture",
          number: "Synthetic cost order",
          sourceId: "return-fixture",
          date: "2026-02-02",
          currency: "USD",
          amountCents: 400,
          pieces: [
            {
              allocationId: "synthetic",
              costLayerId: "synthetic",
              quantity: 1,
              unitCostCents: 400,
            },
          ],
        },
        externalId: journalStatus === "POSTED" ? "567" : null,
        reconciliationIssue: null,
        recoveryCheckedAt: null,
        submittedAt: null,
        confirmedAt: null,
      });
      if (r.method() === "POST") {
        const input = r.postDataJSON();
        if (input.action === "prepare") {
          prepared = true;
          return route.fulfill({ json: journal() });
        }
        if (input.action === "submit") {
          sends++;
          journalStatus = "UNKNOWN";
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic journal response lost" },
          });
        }
        if (input.action === "reconcile") {
          journalStatus = "POSTED";
          return route.fulfill({ json: journal() });
        }
      }
      return route.fulfill({
        json: {
          canWrite: true,
          canSubmit: true,
          nextCursor: null,
          rows: prepared ? [journal()] : [],
        },
      });
    });
    await page
      .getByLabel("I reviewed this cost source and want to prepare its journal draft.")
      .check();
    await page.getByRole("button", { name: "Prepare cost journal", exact: true }).click();
    await expect(
      page.getByText(
        "Cost journal draft " +
          docNumber +
          " saved. Load cost journals below to review it.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Load cost journals", exact: true }).click();
    await page.getByLabel("I reviewed this journal and its company.").check();
    await page.getByRole("button", { name: "Submit cost journal", exact: true }).click();
    await expect(
      page.getByText("Journal: unknown · Reference " + docNumber, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit cost journal", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("I reviewed this journal and its company.").check();
    await page
      .getByRole("button", { name: "Reconcile cost journal", exact: true })
      .click();
    await expect(page.getByText("QuickBooks journal 567", { exact: true })).toBeVisible();
    expect(sends).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("quickbooks-cost-journal.png"),
      fullPage: true,
    });

    const linkRequests: Array<{ requestKey: string }> = [];
    await page.route("**/api/admin/quickbooks/sales-mappings*", (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        kind = url.searchParams.get("kind") ?? request.postDataJSON()?.kind ?? "customer";
      if (request.method() === "POST") {
        const input = request.postDataJSON();
        linkRequests.push(input);
        return route.fulfill({
          status: linkRequests.length === 1 ? 503 : 200,
          json:
            linkRequests.length === 1
              ? { error: "Synthetic sales link interrupted" }
              : {
                  version: 1,
                  kind: input.kind,
                  sourceId: input.sourceId,
                  mode: "sandbox",
                  realm: mapping.realm,
                  externalId: input.externalId,
                  externalName: "Synthetic linked " + input.kind,
                  incomeAccountId: input.kind === "item" ? "9" : null,
                  verifiedAt: new Date().toISOString(),
                },
        });
      }
      if (url.searchParams.get("view") === "provider")
        return route.fulfill({
          json: {
            realm: mapping.realm,
            nextStart: null,
            rows:
              kind === "customer"
                ? [
                    {
                      kind,
                      id: "1",
                      name: "Synthetic company customer",
                      active: true,
                      currency: "USD",
                    },
                  ]
                : [
                    {
                      kind,
                      id: "2",
                      name: "Synthetic non-inventory item",
                      active: true,
                      type: "NonInventory",
                      tracksQuantity: false,
                      incomeAccountId: "9",
                    },
                    {
                      kind,
                      id: "3",
                      name: "Tracked inventory must be excluded",
                      active: true,
                      type: "Inventory",
                      tracksQuantity: true,
                      incomeAccountId: "9",
                    },
                  ],
          },
        });
      return route.fulfill({
        json: {
          canWrite: true,
          realm: mapping.realm,
          nextCursor: null,
          rows: [
            {
              id: "source-" + kind,
              name: "Synthetic application " + kind,
              mapping: null,
            },
          ],
        },
      });
    });
    await page.getByRole("button", { name: "Load sales links", exact: true }).click();
    await page
      .getByLabel("Application record", { exact: true })
      .selectOption("source-customer");
    await page.getByLabel("QuickBooks record", { exact: true }).selectOption("1");
    await page
      .getByLabel(
        "I checked that these records represent the same customer or product in this company.",
      )
      .check();
    await page.getByRole("button", { name: "Save sales link", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic sales link interrupted" }),
    ).toBeVisible();
    await expect(page.getByLabel("QuickBooks record", { exact: true })).toHaveValue("1");
    await page.getByRole("button", { name: "Save sales link", exact: true }).click();
    await expect(
      page.getByText("Saved link: Synthetic linked customer.", { exact: true }),
    ).toBeVisible();
    expect(linkRequests[0].requestKey).toBe(linkRequests[1].requestKey);
    await page.getByLabel("Link type", { exact: true }).selectOption("item");
    await expect(
      page.getByText("Saved link: Synthetic linked customer.", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Load sales links", exact: true }).click();
    await page
      .getByLabel("Application record", { exact: true })
      .selectOption("source-item");
    await expect(
      page.getByRole("option", {
        name: "Tracked inventory must be excluded",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByLabel("QuickBooks record", { exact: true }).selectOption("2");
    await page
      .getByLabel(
        "I checked that these records represent the same customer or product in this company.",
      )
      .check();
    await page.getByRole("button", { name: "Save sales link", exact: true }).click();
    await expect(
      page.getByText("Saved link: Synthetic linked item.", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("quickbooks-sales-links.png"),
      fullPage: true,
    });
  } finally {
    await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    await db.$disconnect();
  }
});
