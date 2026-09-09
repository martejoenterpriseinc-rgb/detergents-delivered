import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";

test("sandbox banner persists on public pages and scrolling", async ({ page }) => {
  for (const path of ["/", "/shop", "/sign-in", "/forgot-password", "/privacy"]) {
    await page.goto(path);
    const bar = page.getByRole("note", { name: "Current environment" });
    await expect(bar).toHaveText("SANDBOX — You are in the test environment");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(bar).toBeInViewport();
    expect(
      await bar.evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgb(185, 28, 28)");
  }
});

test("settings separates API destinations and protects connection metadata", async ({
  page,
}, testInfo) => {
  const db = new PrismaClient({ log: [] });
  const email = `environment-${randomUUID()}@example.test`;
  const password = "Synthetic-Environment-Password-123";
  const managedKeys = [
    "integrations:v1:sandbox:google",
    "integrations:v1:sandbox:destination",
  ];
  try {
    expect(await db.setting.count({ where: { key: { in: managedKeys } } })).toBe(0);
    expect((await page.request.get("/api/admin/integrations")).status()).toBe(401);
    const role = await db.role.upsert({
      where: { code: "ADMIN" },
      update: {},
      create: { code: "ADMIN", name: "Admin" },
    });
    await db.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId: role.id } },
      },
    });
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "API connections" })).toBeVisible();
    await expect(page.getByRole("note", { name: "Current environment" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sandbox — current environment" }),
    ).toHaveAttribute("aria-pressed", "true");
    const response = await page.request.get("/api/admin/integrations?environment=live", {
      headers: { "x-environment": "live" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const status = await response.json();
    expect(status.apiEnvironments.active).toBe("sandbox");
    expect(status.apiEnvironments.environments[0].apiUrl).toBe(
      "http://localhost:3000/api",
    );
    expect(status.apiEnvironments.environments[1].settingsUrl).toBeNull();
    expect(JSON.stringify(status)).not.toMatch(
      /synthetic-ci-only-runtime-secret|dd_ci_password/,
    );
    const row = page.getByRole("row", {
      name: "Google sign-in: OAuth client secret",
      exact: true,
    });
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await row
      .getByLabel("OAuth client secret", { exact: true })
      .fill("synthetic-api-secret-one");
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row.getByRole("status")).toHaveText("Saved successfully");
    const beforeFailedSave = await db.setting.findUniqueOrThrow({
      where: { key: managedKeys[0] },
    });
    expect(JSON.stringify(beforeFailedSave)).not.toContain("synthetic-api-secret-one");
    await page.route("**/api/admin/integrations/fields", async (route) => {
      if (route.request().method() === "PATCH")
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic save unavailable" }),
        });
      await route.continue();
    });
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await row
      .getByLabel("OAuth client secret", { exact: true })
      .fill("synthetic-replacement-retained");
    await row.getByRole("button", { name: "Update", exact: true }).click();
    await expect(row.getByRole("alert")).toHaveText("Synthetic save unavailable");
    await expect(row.getByLabel("OAuth client secret", { exact: true })).toHaveValue(
      "synthetic-replacement-retained",
    );
    expect(
      await db.setting.findUniqueOrThrow({ where: { key: managedKeys[0] } }),
    ).toEqual(beforeFailedSave);
    await page.unroute("**/api/admin/integrations/fields");
    await row.getByRole("button", { name: "Update", exact: true }).click();
    await expect(row.getByRole("status")).toHaveText("Saved successfully");
    await page.reload();
    await expect(row.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    const metadata = await page.request.get("/api/admin/integrations/fields");
    expect(metadata.status()).toBe(200);
    expect(await metadata.text()).not.toMatch(
      /synthetic-api-secret-one|synthetic-replacement-retained|3434343434343434/,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "Switch to Production", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Connect production");
    await page
      .getByLabel("Production application URL")
      .fill("https://production.example.com");
    await page.getByRole("button", { name: "Save address", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "Switch to Production", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByRole("link", { name: "Open Production" }),
    ).toHaveAttribute("href", "https://production.example.com/admin/settings");
    await page.getByRole("button", { name: "Stay in Sandbox", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await page.goto("/admin/integrations");
    await expect(page.getByRole("heading", { name: "API connections" })).toBeVisible();
    await expect(row).toContainText("Saved");
    await page.screenshot({
      path: testInfo.outputPath("environment-settings.png"),
      fullPage: true,
    });
  } finally {
    await db.setting.deleteMany({ where: { key: { in: managedKeys } } });
    const owner = await db.user.findUnique({ where: { email } });
    if (owner)
      await db.auditLog.deleteMany({
        where: { actorUserId: owner.id, action: "integration.field.updated" },
      });
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  }
});
