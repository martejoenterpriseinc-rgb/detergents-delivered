import { randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  registerCustomer,
  createHouseholdUser,
  ensureGoogleHousehold,
} from "./customer-registration";
import {
  deliverRecoveryEmails,
  requestPasswordRecovery,
  resetRecoveredPassword,
  sendRecoveryEmail,
} from "./password-recovery";
import { changeAccountPassword } from "./customer-account";

const original = "Original-Synthetic-Password";
const replacement = "Replacement-Synthetic-Password";
let email: string;
beforeEach(() => {
  email = `recovery-${randomUUID()}@example.test`;
  vi.stubEnv("AUTH_SECRET", "synthetic-recovery-test-secret-only-123456789");
  vi.stubEnv("AUTH_URL", "http://localhost:3000");
  vi.stubEnv("EMAIL_PROVIDER", "sendgrid");
  vi.stubEnv("EMAIL_API_KEY", "synthetic-never-a-real-provider-key");
  vi.stubEnv("EMAIL_FROM", "Detergents Delivered <sender@example.test>");
  vi.stubEnv("DD_EMAIL_ALLOWED_RECIPIENTS", email);
});
afterEach(async () => {
  try {
    const users = await prisma.user.findMany({
      where: { email: { in: [email, `admin-${email}`, `changed-${email}`] } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    // Only this test's synthetic records in the loopback-only guarded CI DB.
    // Leaving an ADMIN here correctly blocks later first-admin bootstrap tests.
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
      await tx.passwordRecovery.deleteMany({ where: { userId: { in: ids } } });
      await tx.session.deleteMany({ where: { userId: { in: ids } } });
      await tx.customer.deleteMany({ where: { userId: { in: ids } } });
      await tx.userRole.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
const registration = () => ({
  name: "Recovery Customer",
  email,
  password: original,
  confirmPassword: original,
});
const change = (token: string) => ({
  token,
  password: replacement,
  confirmPassword: replacement,
});
async function requestedToken() {
  await requestPasswordRecovery(email);
  const delivery = vi
    .fn<(email: string, token: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  await deliverRecoveryEmails(20, delivery);
  return delivery.mock.calls.find(([recipient]) => recipient === email)![1];
}

describe("durable customer recovery", () => {
  it("repairs legacy Google households once without elevating staff or reviving suspended customers", async () => {
    const user = await prisma.user.create({ data: { email, name: "Legacy Google" } });
    await Promise.all([
      ensureGoogleHousehold(user.id, email),
      ensureGoogleHousehold(user.id, email),
    ]);
    const saved = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { customer: true, userRoles: { include: { role: true } } },
    });
    expect(saved.customer?.userId).toBe(user.id);
    expect(saved.userRoles.map((value) => value.role.code)).toEqual(["CUSTOMER"]);
    expect(saved.emailVerified).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { actorUserId: user.id, action: "user.google.household.completed" },
      }),
    ).toBe(1);
    await prisma.customer.update({
      where: { userId: user.id },
      data: { deletedAt: new Date() },
    });
    expect(await ensureGoogleHousehold(user.id, email)).toBe(false);
    const adminRole = await prisma.role.upsert({
      where: { code: "ADMIN" },
      update: {},
      create: { code: "ADMIN", name: "Admin" },
    });
    const admin = await prisma.user.create({
      data: { email: `admin-${email}`, userRoles: { create: { roleId: adminRole.id } } },
    });
    expect(await ensureGoogleHousehold(admin.id, admin.email)).toBe(true);
    expect(await prisma.customer.count({ where: { userId: admin.id } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: admin.id } })).toBe(1);
  });
  it("creates one complete household under duplicate registration and never grants staff roles", async () => {
    const results = await Promise.allSettled([
      registerCustomer(registration()),
      registerCustomer(registration()),
    ]);
    expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { customer: true, userRoles: { include: { role: true } } },
    });
    expect(user.customer?.userId).toBe(user.id);
    expect(user.userRoles.map((value) => value.role.code)).toEqual(["CUSTOMER"]);
    expect(user.emailVerified).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { actorUserId: user.id, action: "user.registered" },
      }),
    ).toBe(1);
  });
  it("does not create recovery jobs for unknown, OAuth-only, or deleted accounts", async () => {
    await requestPasswordRecovery(email);
    const user = await createHouseholdUser({
      email,
      name: "Google Customer",
      emailVerified: new Date(),
    });
    await requestPasswordRecovery(email);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(original, 4), deletedAt: new Date() },
    });
    await requestPasswordRecovery(email);
    expect(await prisma.passwordRecovery.count({ where: { email } })).toBe(0);
  });
  it("encrypts queued links, erases delivery payloads, and consumes all links exactly once", async () => {
    const user = await registerCustomer(registration());
    const token = await requestedToken();
    const hash = createHash("sha256").update(token).digest("hex");
    const row = await prisma.passwordRecovery.findUniqueOrThrow({
      where: { tokenHash: hash },
    });
    expect(row.tokenCiphertext).toBeNull();
    expect(row.deliveredAt).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(token);
    const sibling = await requestedToken();
    await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: randomUUID(),
        expires: new Date(Date.now() + 60000),
      },
    });
    const results = await Promise.allSettled([
      resetRecoveredPassword(change(token)),
      resetRecoveredPassword(change(token)),
    ]);
    expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    await expect(resetRecoveredPassword(change(sibling))).rejects.toThrow(
      /invalid|expired/,
    );
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.sessionVersion).toBe(1);
    expect(await bcrypt.compare(replacement, saved.passwordHash!)).toBe(true);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    const audits = await prisma.auditLog.findMany({
      where: { actorUserId: user.id, action: "user.password.recovered" },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(token);
    expect(JSON.stringify(audits)).not.toContain(replacement);
  });
  it("bounds requests per email, persists failed delivery, and retries without changing the link", async () => {
    await registerCustomer(registration());
    await Promise.all(Array.from({ length: 6 }, () => requestPasswordRecovery(email)));
    expect(await prisma.passwordRecovery.count({ where: { email } })).toBe(3);
    const failed = vi.fn(async () => {
      throw new Error("Synthetic provider outage");
    });
    await deliverRecoveryEmails(20, failed);
    const rows = await prisma.passwordRecovery.findMany({ where: { email } });
    expect(
      rows.every(
        (value) => value.tokenCiphertext && value.attempts === 1 && !value.deliveredAt,
      ),
    ).toBe(true);
    await prisma.passwordRecovery.updateMany({
      where: { email },
      data: { nextAttemptAt: new Date(0) },
    });
    const delivered = vi
      .fn<(email: string, token: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    await Promise.all([
      deliverRecoveryEmails(20, delivered),
      deliverRecoveryEmails(20, delivered),
    ]);
    expect(
      delivered.mock.calls.filter(([recipient]) => recipient === email),
    ).toHaveLength(3);
  });
  it("rejects expired, deleted-user, changed-email, and stale-session links", async () => {
    const user = await registerCustomer(registration());
    const token = await requestedToken();
    await prisma.passwordRecovery.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await expect(resetRecoveredPassword(change(token))).rejects.toThrow(/expired/);
    const current = await requestedToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    await expect(resetRecoveredPassword(change(current))).rejects.toThrow(/invalid/);
    await prisma.user.update({
      where: { id: user.id },
      data: { sessionVersion: 0, email: `changed-${email}` },
    });
    await expect(resetRecoveredPassword(change(current))).rejects.toThrow(/invalid/);
    await prisma.user.update({
      where: { id: user.id },
      data: { email, deletedAt: new Date() },
    });
    await expect(resetRecoveredPassword(change(current))).rejects.toThrow(/invalid/);
  });
  it("invalidates recovery during authenticated password changes and preserves bootstrap gating", async () => {
    const user = await registerCustomer(registration());
    const token = await requestedToken();
    await changeAccountPassword(user.id, {
      currentPassword: original,
      newPassword: replacement,
      confirmPassword: replacement,
    });
    await expect(
      resetRecoveredPassword({ token, password: original, confirmPassword: original }),
    ).rejects.toThrow(/invalid/);
    await prisma.user.update({
      where: { id: user.id },
      data: { mustChangeCredentials: true },
    });
    const next = await requestedToken();
    await resetRecoveredPassword({
      token: next,
      password: original,
      confirmPassword: original,
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .mustChangeCredentials,
    ).toBe(true);
  });
  it("disables tracking, fixes the sender URL, and never sends to unapproved staging recipients", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    await sendRecoveryEmail(email, "a".repeat(64));
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse(call[1].body as string);
    expect(body.content[0].value).toContain(
      "http://localhost:3000/reset-password#token=",
    );
    expect(body.tracking_settings.click_tracking).toEqual({
      enable: false,
      enable_text: false,
    });
    await expect(
      sendRecoveryEmail("unapproved@example.test", "b".repeat(64)),
    ).rejects.toThrow(/not enabled/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
