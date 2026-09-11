import "@/tests/integration-guard";
import { randomUUID, randomBytes } from "node:crypto";
import { beforeEach, afterEach, afterAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import * as provider from "@/lib/integrations/twilio-client";
import * as delivery from "@/lib/integrations/twilio-delivery";
import { enqueueDeliveryText } from "./sms-outbox";
import {
  runDeliveryTexts,
  receiveDeliveryTextStatus,
  deliveryTextStatus,
} from "./sms-delivery";
const config = {
  mode: "sandbox" as const,
  origin: "http://localhost:3000",
  accountSid: "AC" + "d".repeat(32),
  authToken: "synthetic",
  sender: "+15555550100",
};
const users: string[] = [];
let orderId: string, consentId: string, phone: string, textId: string;
const now = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(15, 0, 0, 0);
  return d;
};
beforeEach(async () => {
  phone = "+1555" + String(Math.floor(Math.random() * 10000000)).padStart(7, "0");
  const user = await prisma.user.create({
    data: {
      email: "sms-worker-" + randomUUID() + "@example.test",
      emailVerified: new Date(),
      customer: { create: { phone, smsNotifications: true } },
    },
    include: { customer: true },
  });
  users.push(user.id);
  const consent = await prisma.smsConsent.create({
    data: {
      customerId: user.customer!.id,
      environment: config.mode,
      accountSid: config.accountSid,
      sender: config.sender,
      phone,
      timezone: "America/Chicago",
      consentVersion: "delivery-texts-v1",
      codeHash: randomBytes(32).toString("hex"),
      state: "ACTIVE",
      activatedAt: new Date(),
      expiresAt: new Date(),
    },
  });
  consentId = consent.id;
  const order = await prisma.order.create({
    data: {
      customerId: user.customer!.id,
      number: "SMS-" + randomUUID(),
      status: "OUT_FOR_DELIVERY",
    },
  });
  orderId = order.id;
  // Fixture time is explicit; the production enqueue service never rewrites history.
  const text = await prisma.smsDelivery.create({
    data: {
      orderId,
      consentId,
      environment: config.mode,
      accountSid: config.accountSid,
      sender: config.sender,
      phone,
      kind: "OUT_FOR_DELIVERY",
      nextAttemptAt: new Date(0),
      expiresAt: new Date(now().getTime() + 86400000),
    },
  });
  textId = text.id;
  vi.spyOn(provider, "smsConfig").mockResolvedValue(config);
  vi.stubEnv("DD_SMS_DELIVERY_ENABLED", "true");
  vi.stubEnv(
    "DD_SMS_DELIVERY_ACCOUNT",
    `${config.mode}:${config.accountSid}:${config.sender}`,
  );
  vi.stubEnv("DD_SMS_ALLOWED_RECIPIENTS", phone);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
const sid = () => "SM" + randomBytes(16).toString("hex");
async function receipt(status = "delivered", messageSid = sid()) {
  const row = await prisma.smsDelivery.findUniqueOrThrow({ where: { id: textId } });
  return {
    sid: messageSid,
    account_sid: config.accountSid,
    from: config.sender,
    to: phone,
    body: row.body!,
    status: status as "delivered",
  };
}
it("queues each order update once and rolls queue creation back with its source transaction", async () => {
  await prisma.$transaction(async (tx) => {
    await enqueueDeliveryText(tx, orderId, "OUT_FOR_DELIVERY");
    await enqueueDeliveryText(tx, orderId, "OUT_FOR_DELIVERY");
  });
  expect(await prisma.smsDelivery.count({ where: { orderId } })).toBe(1);
  await expect(
    prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: "DELIVERED" } });
      await enqueueDeliveryText(tx, orderId, "DELIVERED");
      throw new Error("synthetic rollback");
    }),
  ).rejects.toThrow();
  expect(await prisma.smsDelivery.count({ where: { orderId } })).toBe(1);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
    "OUT_FOR_DELIVERY",
  );
});
it("makes one uncertain send, reconciles its signed callback once, and protects delivery evidence", async () => {
  const send = vi
    .spyOn(delivery, "submitDeliveryText")
    .mockRejectedValue(new Error("synthetic lost response"));
  await Promise.all([
    runDeliveryTexts(async () => true, now()),
    runDeliveryTexts(async () => true, now()),
  ]);
  await runDeliveryTexts(async () => true, now());
  expect(send).toHaveBeenCalledTimes(1);
  const messageSid = sid(),
    fields = {
      AccountSid: config.accountSid,
      MessageSid: messageSid,
      From: config.sender,
      To: phone,
      MessageStatus: "delivered",
    };
  await Promise.all([
    receiveDeliveryTextStatus(config, textId, fields),
    receiveDeliveryTextStatus(config, textId, fields),
  ]);
  expect(
    (await prisma.smsDelivery.findUniqueOrThrow({ where: { id: textId } })).status,
  ).toBe("DELIVERED");
  expect(await prisma.smsDeliveryEvent.count({ where: { deliveryId: textId } })).toBe(1);
  await receiveDeliveryTextStatus(config, textId, { ...fields, MessageStatus: "sent" });
  expect(
    (await prisma.smsDelivery.findUniqueOrThrow({ where: { id: textId } })).status,
  ).toBe("DELIVERED");
  await expect(
    prisma.smsDelivery.update({ where: { id: textId }, data: { providerSid: sid() } }),
  ).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});
it("prevents sending when consent is revoked, the recipient is unapproved, the job lease is lost or delivery is disabled", async () => {
  const send = vi.spyOn(delivery, "submitDeliveryText").mockRejectedValue(new Error());
  await expect(runDeliveryTexts(async () => false, now())).rejects.toThrow();
  vi.stubEnv("DD_SMS_DELIVERY_ENABLED", "false");
  await runDeliveryTexts(async () => true, now());
  expect(send).not.toHaveBeenCalled();
  vi.stubEnv("DD_SMS_DELIVERY_ENABLED", "true");
  vi.stubEnv("DD_SMS_ALLOWED_RECIPIENTS", "");
  await runDeliveryTexts(async () => true, now());
  expect(send).not.toHaveBeenCalled();
  vi.stubEnv("DD_SMS_ALLOWED_RECIPIENTS", phone);
  await prisma.smsConsent.update({
    where: { id: consentId },
    data: { state: "REVOKED", revokedAt: new Date() },
  });
  await runDeliveryTexts(async () => true, new Date(now().getTime() + 120000));
  expect(send).not.toHaveBeenCalled();
  expect(
    (await prisma.smsDelivery.findUniqueOrThrow({ where: { id: textId } })).status,
  ).toBe("SKIPPED");
});
it("backs off only a confirmed rate limit and then reads provider receipts without resending", async () => {
  const send = vi
    .spyOn(delivery, "submitDeliveryText")
    .mockRejectedValueOnce(new delivery.SmsRateLimit());
  await runDeliveryTexts(async () => true, now());
  const row = await prisma.smsDelivery.findUniqueOrThrow({ where: { id: textId } });
  expect(row.status).toBe("PENDING");
  expect(row.nextAttemptAt > now()).toBe(true);
  const messageSid = sid();
  send.mockImplementation(async () => receipt("sent", messageSid));
  await runDeliveryTexts(async () => true, new Date(now().getTime() + 300000));
  expect(send).toHaveBeenCalledTimes(2);
  vi.spyOn(delivery, "readDeliveryText").mockImplementation(async () =>
    receipt("delivered", messageSid),
  );
  await runDeliveryTexts(async () => true, new Date(now().getTime() + 600000));
  expect(send).toHaveBeenCalledTimes(2);
  expect(
    (await prisma.smsDelivery.findUniqueOrThrow({ where: { id: textId } })).status,
  ).toBe("DELIVERED");
});

it("restricts delivery monitoring to operations administrators and omits recipients and message bodies", async () => {
  const actor = users.at(-1)!;
  await expect(deliveryTextStatus(actor)).rejects.toMatchObject({ status: 403 });
  const role = await prisma.role.upsert({
    where: { code: "ADMIN" },
    update: {},
    create: { code: "ADMIN", name: "Admin" },
  });
  await prisma.userRole.create({ data: { userId: actor, roleId: role.id } });
  const status = await deliveryTextStatus(actor);
  expect(status.rows.some((row) => row.id === textId)).toBe(true);
  expect(JSON.stringify(status)).not.toContain(phone);
  expect(status.rows[0]).not.toHaveProperty("body");
});
