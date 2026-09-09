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
  try {
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
    await expect(
      page.getByRole("heading", { name: "Sandbox & live APIs" }),
    ).toBeVisible();
    await expect(page.getByRole("note", { name: "Current environment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Live not connected" })).toBeDisabled();
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
    await page.screenshot({
      path: testInfo.outputPath("environment-settings.png"),
      fullPage: true,
    });
  } finally {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  }
});
