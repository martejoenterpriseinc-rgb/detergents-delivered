import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
import { receiptFixture } from "../tests/customer-receipt-fixture";

test("CPA reads original financial evidence, exports and sees incomplete evidence", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] });
  const users: string[] = [];
  try {
    const password = "Synthetic-Ledger-Password-123";
    const role = await db.role.upsert({
      where: { code: "CPA" },
      update: {},
      create: { code: "CPA", name: "CPA" },
    });
    const user = await db.user.create({
      data: {
        email: `cpa-ledger-${randomUUID()}@example.test`,
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(user.id);
    const fixture = await receiptFixture(db, { financialEvidence: true });
    users.push(fixture.userId);
    const query = new URLSearchParams({
      from: "2026-02-01",
      to: "2026-02-01",
      orderId: fixture.orderId,
    });
    const api = `/api/admin/reports/ledger?${query}`;
    expect((await page.request.get(api)).status()).toBe(401);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto(`/admin/cpa/ledger?${query}`);
    await expect(
      page.getByRole("heading", { name: "Sales, refunds & cost ledger" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Recorded cash change", exact: true }),
    ).toContainText("$22.68");
    await expect(
      page.getByRole("region", { name: "Recorded COGS change", exact: true }),
    ).toContainText("$12.00");
    await expect(
      page.getByRole("region", { name: "Merchandise less recorded COGS", exact: true }),
    ).toContainText("$9.00");
    await expect(
      page.getByText("Filtered to one order.", { exact: false }),
    ).toBeVisible();
    const href = await page
      .getByRole("link", { name: "Export ledger CSV" })
      .getAttribute("href");
    const csv = await page.request.get(href!);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["cache-control"]).toContain("no-store");
    expect(await csv.text()).toContain('"22.68"');
    expect(await csv.text()).not.toContain("private-tax-id");
    expect((await page.request.post(api, { data: {} })).status()).toBe(405);
    await page.reload();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: info.outputPath("cpa-ledger.png"), fullPage: true });
    const incomplete = await receiptFixture(db);
    users.push(incomplete.userId);
    query.set("orderId", incomplete.orderId);
    await page.goto(`/admin/cpa/ledger?${query}`);
    await expect(
      page.getByRole("alert", { name: "Financial evidence review", exact: true }),
    ).toContainText("1 events have incomplete financial evidence");
    await expect(
      page.getByRole("region", { name: "Merchandise less recorded COGS", exact: true }),
    ).toContainText("Needs review");
    await page.getByLabel("From", { exact: true }).fill("2026-02-02");
    await page.getByLabel("To", { exact: true }).fill("2026-02-02");
    await page.getByRole("button", { name: "Apply dates" }).click();
    await expect(page.getByText("No recorded events for these dates.")).toBeVisible();
  } finally {
    await db.user.updateMany({
      where: { id: { in: users } },
      data: { deletedAt: new Date() },
    });
    await db.$disconnect();
  }
});
