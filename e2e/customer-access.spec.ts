import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";

test("home login, password visibility, recovery, and revoked sessions", async ({
  page,
  browser,
}, testInfo) => {
  const db = new PrismaClient({ log: [] });
  const email = `access-${randomUUID()}@example.test`;
  const password = "Synthetic-Customer-Password-123";
  const newPassword = "Changed-Synthetic-Password-456";
  const token = randomBytes(32).toString("hex");
  const second = await browser.newContext();
  try {
    const role = await db.role.upsert({
      where: { code: "CUSTOMER" },
      update: {},
      create: { code: "CUSTOMER", name: "Customer" },
    });
    const user = await db.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId: role.id } },
        customer: { create: { firstName: "Synthetic" } },
      },
    });
    await page.goto("/");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Sign in", exact: true })
      .click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    const input = page.getByLabel("Password", { exact: true });
    await input.fill(password);
    await expect(input).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(input).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(
      page.getByRole("heading", { name: "Verify your email", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Admin / Owner", exact: true }),
    ).toHaveCount(0);
    // Synthetic verification evidence only in the guarded CI database. No email
    // provider is contacted. A GET/link scanner never consumes the token.
    const verificationToken = randomBytes(32).toString("hex");
    await db.verificationToken.create({
      data: {
        identifier: `dd-email-verification:v1:${user.id}:${createHash("sha256").update(email).digest("hex")}:0`,
        token: createHash("sha256").update(verificationToken).digest("hex"),
        expires: new Date(Date.now() + 60000),
      },
    });
    await page.goto(`/verify-email#token=${verificationToken}`);
    await expect(
      page.getByRole("button", { name: "Confirm email", exact: true }),
    ).toBeVisible();
    expect(page.url()).not.toContain(verificationToken);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBeNull();
    await page.route(
      "**/api/account/email-verification",
      async (route) => {
        await route.fetch(); // Server committed, browser lost the response.
        await route.abort("failed");
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Confirm email", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /fetch|connection|failed/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm email", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Email verified");
    expect(
      await db.auditLog.count({
        where: { actorUserId: user.id, action: "user.email.verified" },
      }),
    ).toBe(1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
    ).toBe(user.passwordHash);
    await page.screenshot({
      path: testInfo.outputPath("email-verification.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: "Your account", exact: true }).click();
    await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Admin / Owner", exact: true }),
    ).toHaveCount(0);
    const recovery = await second.newPage();
    await recovery.goto("/sign-in");
    await recovery
      .getByRole("link", { name: "Forgot password or login details?" })
      .click();
    await expect(
      recovery.getByRole("heading", { name: "Forgot your password?" }),
    ).toBeVisible();
    await expect(
      recovery.getByRole("link", { name: "Recover your Google account" }),
    ).toBeVisible();
    const denied = await recovery.request.post("/api/account-recovery/reset", {
      headers: { origin: "https://untrusted.example" },
      data: { token, password: newPassword, confirmPassword: newPassword },
    });
    expect(denied.status()).toBe(403);
    // Seed only a synthetic token in the guarded local CI database. Provider mail
    // delivery is verified separately; this test never sends real messages.
    await db.passwordRecovery.create({
      data: {
        userId: user.id,
        email,
        sessionVersion: 0,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await recovery.goto(`/reset-password#token=${token}`);
    await recovery.getByLabel("New password", { exact: true }).fill(newPassword);
    await recovery.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
    expect(recovery.url()).not.toContain(token);
    await recovery.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(recovery.getByRole("status")).toContainText("Password reset");
    expect((await page.request.get("/api/account")).status()).toBe(401);
    const replay = await recovery.request.post("/api/account-recovery/reset", {
      headers: { origin: "http://localhost:3000" },
      data: {
        token,
        password: "Another-Synthetic-Password",
        confirmPassword: "Another-Synthetic-Password",
      },
    });
    expect(replay.status()).toBe(400);
    await recovery.getByRole("link", { name: "Back to sign in" }).click();
    await recovery.getByLabel("Email", { exact: true }).fill(email);
    await recovery.getByLabel("Password", { exact: true }).fill(newPassword);
    await recovery.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(recovery).toHaveURL(/\/account$/);
    await page.goto("/register");
    await expect(page.getByLabel("Confirm password", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("customer-register.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await second.close();
    await db.$disconnect();
  }
});
