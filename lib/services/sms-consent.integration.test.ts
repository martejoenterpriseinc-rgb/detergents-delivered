import "@/tests/integration-guard";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import * as provider from "@/lib/integrations/twilio-client";
import {
  beginSmsConsent,
  receiveSmsConsent,
  smsConsentStatus,
  stopSmsConsent,
} from "./sms-consent";
import { updateCustomerProfile, updateNotifications } from "./customer-account";
const config = {
  mode: "sandbox" as const,
  origin: "http://localhost:3000",
  accountSid: "AC" + "a".repeat(32),
  authToken: "synthetic",
  sender: "+15555550100",
};
const users: string[] = [];
let userId: string, customerId: string, phone: string;
beforeEach(async () => {
  phone = "+1555" + String(Math.floor(Math.random() * 10000000)).padStart(7, "0");
  const user = await prisma.user.create({
    data: {
      email: "sms-" + randomUUID() + "@example.test",
      emailVerified: new Date(),
      customer: { create: { firstName: "Synthetic", phone } },
    },
    include: { customer: true },
  });
  userId = user.id;
  customerId = user.customer!.id;
  users.push(userId);
  vi.spyOn(provider, "smsConfig").mockResolvedValue(config);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
const input = { confirmed: true, timezone: "America/Chicago" };
const fields = (Body: string, From = phone) => ({
  MessageSid: "SM" + randomBytes(16).toString("hex"),
  AccountSid: config.accountSid,
  From,
  To: config.sender,
  Body,
});
it("requires verified email and phone possession, rejects other phones, deduplicates signed callbacks and honors STOP", async () => {
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: null } });
  await expect(beginSmsConsent(userId, input)).rejects.toMatchObject({ status: 403 });
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: new Date() },
  });
  const challenge = await beginSmsConsent(userId, input);
  expect((await smsConsentStatus(userId)).active).toBe(false);
  await receiveSmsConsent(config, fields(challenge.message, "+15555550999"));
  expect((await smsConsentStatus(userId)).active).toBe(false);
  await receiveSmsConsent({ ...config, mode: "live" }, fields(challenge.message));
  expect((await smsConsentStatus(userId)).active).toBe(false);
  const valid = fields(challenge.message);
  await Promise.all([receiveSmsConsent(config, valid), receiveSmsConsent(config, valid)]);
  expect((await smsConsentStatus(userId)).active).toBe(true);
  const row = await prisma.smsConsent.findFirstOrThrow({ where: { customerId } });
  expect(row.codeHash).not.toContain(challenge.message.slice(3));
  expect(
    await prisma.auditLog.count({
      where: { entityId: row.id, action: "sms.consent.verified" },
    }),
  ).toBe(1);
  const stop = fields("STOP");
  await Promise.all([receiveSmsConsent(config, stop), receiveSmsConsent(config, stop)]);
  expect((await smsConsentStatus(userId)).active).toBe(false);
  await receiveSmsConsent(config, valid);
  await receiveSmsConsent(config, fields("START"));
  expect((await smsConsentStatus(userId)).active).toBe(false);
  await expect(
    prisma.smsConsent.update({
      where: { id: row.id },
      data: { state: "ACTIVE", revokedAt: null },
    }),
  ).rejects.toThrow();
});
it("revokes consent on phone or preference changes and never treats a legacy preference as verified consent", async () => {
  await updateNotifications(userId, {
    emailNotifications: false,
    smsNotifications: true,
  });
  expect((await smsConsentStatus(userId)).active).toBe(false);
  let challenge = await beginSmsConsent(userId, input);
  await receiveSmsConsent(config, fields(challenge.message));
  await updateCustomerProfile(userId, {
    firstName: "Synthetic",
    lastName: "",
    phone: "+15555550998",
  });
  expect((await smsConsentStatus(userId)).active).toBe(false);
  phone = "+15555550998";
  challenge = await beginSmsConsent(userId, input);
  await receiveSmsConsent(config, fields(challenge.message));
  expect((await smsConsentStatus(userId)).active).toBe(true);
  await updateNotifications(userId, {
    emailNotifications: false,
    smsNotifications: false,
  });
  await updateNotifications(userId, {
    emailNotifications: false,
    smsNotifications: true,
  });
  expect((await smsConsentStatus(userId)).active).toBe(false);
});
it("bounds activation requests, preserves audit atomicity and supports repeatable cancellation", async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditLog" ADD CONSTRAINT "sms_test_audit" CHECK (action <> 'sms.consent.requested') NOT VALID`,
  );
  try {
    await expect(beginSmsConsent(userId, input)).rejects.toThrow();
    expect(await prisma.smsConsent.count({ where: { customerId } })).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT "sms_test_audit"',
    );
  }
  for (let i = 0; i < 5; i++) await beginSmsConsent(userId, input);
  await expect(beginSmsConsent(userId, input)).rejects.toMatchObject({ status: 429 });
  await stopSmsConsent(userId);
  await stopSmsConsent(userId);
  expect(
    await prisma.smsConsent.count({ where: { customerId, state: { not: "REVOKED" } } }),
  ).toBe(0);
});
it("rejects wrong-company and expired activation evidence without changing consent", async () => {
  const challenge = await beginSmsConsent(userId, input);
  await expect(
    receiveSmsConsent(config, {
      ...fields(challenge.message),
      AccountSid: "AC" + "c".repeat(32),
    }),
  ).rejects.toThrow();
  const row = await prisma.smsConsent.findFirstOrThrow({ where: { customerId } });
  await stopSmsConsent(userId);
  const expired = await prisma.smsConsent.create({
    data: {
      customerId,
      environment: config.mode,
      accountSid: config.accountSid,
      sender: config.sender,
      phone,
      timezone: input.timezone,
      consentVersion: "delivery-texts-v1",
      codeHash: createHash("sha256").update("ABCDEF1234").digest("hex"),
      expiresAt: new Date(0),
    },
  });
  await expect(
    prisma.smsConsent.update({
      where: { id: expired.id },
      data: { expiresAt: new Date() },
    }),
  ).rejects.toThrow();
  await updateNotifications(userId, {
    emailNotifications: false,
    smsNotifications: true,
  });
  await receiveSmsConsent(config, fields("DD ABCDEF1234"));
  await receiveSmsConsent(config, fields(challenge.message));
  expect(
    (await prisma.smsConsent.findUniqueOrThrow({ where: { id: row.id } })).state,
  ).toBe("REVOKED");
  expect((await smsConsentStatus(userId)).active).toBe(false);
});
