import { randomUUID, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createHouseholdUser } from "./customer-registration";
import {
  confirmEmailVerification,
  requestEmailVerification,
  sendVerificationEmail,
} from "./email-verification";

let ids: string[];
let email: string;
beforeEach(() => {
  ids = [];
  email = `verify-${randomUUID()}@example.test`;
  vi.stubEnv("AUTH_SECRET", "synthetic-verification-secret-only-123456789");
  vi.stubEnv("AUTH_URL", "http://localhost:3000");
  vi.stubEnv("EMAIL_PROVIDER", "sendgrid");
  vi.stubEnv("EMAIL_API_KEY", "synthetic-no-provider-access");
  vi.stubEnv("EMAIL_FROM", "Detergents Delivered <sender@example.test>");
  vi.stubEnv("DD_EMAIL_ALLOWED_RECIPIENTS", email);
});
afterEach(async () => {
  try {
    await prisma.verificationToken.deleteMany({
      where: {
        OR: ids.map((id) => ({
          identifier: { startsWith: `dd-email-verification:v1:${id}:` },
        })),
      },
    });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
async function account(address = email) {
  const user = await createHouseholdUser({
    email: address,
    name: "Synthetic Verification",
    passwordHash: "synthetic-preserved-hash",
  });
  ids.push(user.id);
  return user;
}
async function request(userId: string) {
  const send = vi
    .fn<(email: string, token: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const result = await requestEmailVerification(userId, send);
  expect(result).toEqual({ verified: false });
  return send.mock.calls[0][1];
}
const tokens = (id: string) =>
  prisma.verificationToken.findMany({
    where: { identifier: { startsWith: `dd-email-verification:v1:${id}:` } },
  });

describe("email verification in isolated PostgreSQL", () => {
  it("verifies once with atomic token consumption and leaves password, roles and customer intact", async () => {
    const user = await account();
    const token = await request(user.id);
    const sibling = await request(user.id);
    expect(JSON.stringify(await tokens(user.id))).not.toContain(token);
    expect((await tokens(user.id))[0].identifier).not.toContain(email);
    const results = await Promise.all([
      confirmEmailVerification(user.id, { token }),
      confirmEmailVerification(user.id, { token }),
    ]);
    expect(results).toEqual([{ verified: true }, { verified: true }]);
    expect(await confirmEmailVerification(user.id, { token: sibling })).toEqual({
      verified: true,
    });
    const saved = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { customer: true, userRoles: { include: { role: true } } },
    });
    expect(saved.emailVerified).not.toBeNull();
    expect(saved.passwordHash).toBe(user.passwordHash);
    expect(saved.sessionVersion).toBe(user.sessionVersion);
    expect(saved.customer?.userId).toBe(user.id);
    expect(saved.userRoles.map((x) => x.role.code)).toEqual(["CUSTOMER"]);
    expect(await tokens(user.id)).toHaveLength(0);
    const audits = await prisma.auditLog.findMany({
      where: { actorUserId: user.id, action: "user.email.verified" },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(token);
  });
  it("binds links to their account, email and session generation and blocks suspended/unfinished accounts", async () => {
    const user = await account();
    const other = await account(`other-${email}`);
    const token = await request(user.id);
    await expect(confirmEmailVerification(other.id, { token })).rejects.toThrow(
      /invalid/,
    );
    for (const data of [
      { email: `changed-${email}` },
      { sessionVersion: 1 },
      { deletedAt: new Date() },
      { mustChangeCredentials: true },
    ]) {
      await prisma.user.update({ where: { id: user.id }, data });
      await expect(confirmEmailVerification(user.id, { token })).rejects.toThrow();
      await prisma.user.update({
        where: { id: user.id },
        data: { email, sessionVersion: 0, deletedAt: null, mustChangeCredentials: false },
      });
    }
    await prisma.verificationToken.update({
      where: { token: createHash("sha256").update(token).digest("hex") },
      data: { expires: new Date(0) },
    });
    await expect(confirmEmailVerification(user.id, { token })).rejects.toThrow(/expired/);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBeNull();
  });
  it("rolls back verification and token consumption if auditing fails", async () => {
    const user = await account();
    const token = await request(user.id);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AuditLog" ADD CONSTRAINT dd_email_verification_fault CHECK (action <> 'user.email.verified') NOT VALID`,
    );
    try {
      await expect(confirmEmailVerification(user.id, { token })).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "AuditLog" DROP CONSTRAINT dd_email_verification_fault`,
      );
    }
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBeNull();
    expect(await tokens(user.id)).toHaveLength(1);
    expect(await confirmEmailVerification(user.id, { token })).toEqual({
      verified: true,
    });
  });
  it("reports failed delivery without verification and permits resending without invalidating the first email", async () => {
    const user = await account();
    let uncertainToken = "";
    await expect(
      requestEmailVerification(user.id, async (_email, token) => {
        uncertainToken = token;
        throw new Error("Synthetic lost provider response");
      }),
    ).rejects.toThrow(/could not be confirmed/);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBeNull();
    await request(user.id);
    expect(await tokens(user.id)).toHaveLength(2);
    expect(await confirmEmailVerification(user.id, { token: uncertainToken })).toEqual({
      verified: true,
    });
  });
  it("fails closed on missing provider configuration and bounds concurrent requests", async () => {
    const user = await account();
    const send = vi.fn().mockResolvedValue(undefined);
    vi.stubEnv("EMAIL_API_KEY", "");
    await expect(requestEmailVerification(user.id, send)).rejects.toThrow(
      /temporarily unavailable/,
    );
    expect(send).not.toHaveBeenCalled();
    expect(await tokens(user.id)).toHaveLength(0);
    vi.stubEnv("EMAIL_API_KEY", "synthetic-no-provider-access");
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => requestEmailVerification(user.id, send)),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    expect(send).toHaveBeenCalledTimes(3);
    expect(await tokens(user.id)).toHaveLength(3);
  });
  it("rejects another token purpose even when the hash matches", async () => {
    const user = await account();
    const token = await request(user.id);
    const digest = createHash("sha256").update(token).digest("hex");
    const row = (await tokens(user.id))[0];
    await prisma.verificationToken.update({
      where: { token: digest },
      data: { identifier: "some-other-auth-purpose" },
    });
    try {
      await expect(confirmEmailVerification(user.id, { token })).rejects.toThrow(
        /invalid/,
      );
    } finally {
      await prisma.verificationToken.update({
        where: { token: digest },
        data: { identifier: row.identifier },
      });
    }
  });
  it("uses the pinned sender/origin, disables tracking and blocks unapproved sandbox recipients", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    await sendVerificationEmail(email, "a".repeat(64));
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse(options.body as string);
    expect(body.content[0].value).toContain("http://localhost:3000/verify-email#token=");
    expect(body.tracking_settings).toEqual({
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
    });
    await expect(
      sendVerificationEmail(`other-${email}`, "b".repeat(64)),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
