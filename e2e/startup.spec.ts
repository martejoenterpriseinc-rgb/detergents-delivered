import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";

test("database-backed startup, separate sessions, persistence, and revoked access", async ({
  page,
  browser,
}, testInfo) => {
  const db = new PrismaClient({ log: [] });
  const marker = randomUUID();
  const password = "Synthetic-Browser-Password-12345";
  const customerContext = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const customerPage = await customerContext.newPage();
  const admins: string[] = [];
  try {
    for (const code of ["ADMIN", "CUSTOMER"] as const) {
      const role = await db.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      const user = await db.user.create({
        data: {
          email: `${code.toLowerCase()}-${marker}@example.test`,
          name: "Synthetic startup test",
          emailVerified: new Date(),
          passwordHash: await bcrypt.hash(password, 12),
          userRoles: { create: { roleId: role.id } },
        },
      });
      admins.push(user.id);
    }
    async function login(target: Page, email: string, secret: string, path: string) {
      await target.goto(`/sign-in?callbackUrl=${encodeURIComponent(path)}`);
      await target.getByLabel("Email", { exact: true }).fill(email);
      await target.getByLabel("Password", { exact: true }).fill(secret);
      await target.getByRole("button", { name: "Sign in", exact: true }).click();
    }
    expect((await page.request.get("/api/ready")).status()).toBe(200);
    expect(
      (
        await page.request.post("/api/vendors", { data: { name: "Unauthorized" } })
      ).status(),
    ).toBe(401);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/sign-in/);
    await login(
      page,
      `admin-${marker}@example.test`,
      "Incorrect-Synthetic-Password",
      "/admin",
    );
    await expect(page).toHaveURL(/error=credentials/);
    await login(page, `admin-${marker}@example.test`, password, "/admin");
    await expect(
      page.getByRole("heading", { name: "Your day, delivered.", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Your day, delivered.", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("admin-after-refresh.png"),
      fullPage: true,
    });
    const created = await page.request.post("/api/vendors", {
      data: { name: `Synthetic vendor ${marker}` },
    });
    expect(created.status()).toBe(201);
    const { vendor } = await created.json();
    expect(
      await db.vendor.count({
        where: { id: vendor.id, name: `Synthetic vendor ${marker}` },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { actorUserId: admins[0], entityId: vendor.id } }),
    ).toBeGreaterThan(0);
    await login(customerPage, `customer-${marker}@example.test`, password, "/account");
    await expect(customerPage).toHaveURL(/\/account$/);
    expect((await customerPage.request.get("/api/vendors")).status()).toBe(403);
    expect(
      (
        await customerPage.request.post("/api/vendors", {
          data: { name: "Forbidden customer vendor" },
        })
      ).status(),
    ).toBe(403);
    await customerPage.goto("/admin");
    await expect(customerPage).toHaveURL(/error=forbidden/);
    await customerPage.screenshot({
      path: testInfo.outputPath("customer-admin-denied.png"),
      fullPage: true,
    });
    await db.userRole.deleteMany({ where: { userId: admins[0] } });
    expect((await page.request.get("/api/vendors")).status()).toBe(403);
    await db.user.update({ where: { id: admins[0] }, data: { deletedAt: new Date() } });
    expect((await page.request.get("/api/vendors")).status()).toBe(401);
    expect(
      await db.vendor.count({
        where: { name: { in: ["Unauthorized", "Forbidden customer vendor"] } },
      }),
    ).toBe(0);
    await testInfo.attach("database-assertions", {
      body: JSON.stringify({
        vendorId: vendor.id,
        persisted: true,
        audited: true,
        unauthorizedWrites: 0,
        roleRevocation: 403,
        deletedAccount: 401,
      }),
      contentType: "application/json",
    });
  } finally {
    await customerContext.close();
    await db.$disconnect();
  }
});
