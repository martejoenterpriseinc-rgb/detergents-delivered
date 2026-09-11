import { randomUUID, randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sealIntegration } from "../lib/integrations/secrets";
import "../tests/integration-guard";
test("administrators can review protected delivery-text uncertainty without a resend action", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    marker = randomUUID(),
    key = "integrations:v1:sandbox:sms",
    password = "Synthetic-Text-Monitor-123",
    users: string[] = [];
  const original = await db.setting.findUnique({ where: { key } }),
    values = {
      TWILIO_ACCOUNT_SID: "AC" + "e".repeat(32),
      TWILIO_AUTH_TOKEN: "synthetic-monitor-token",
      TWILIO_FROM: "+15555550100",
    };
  try {
    const valueJson = {
      version: 1,
      ...sealIntegration({ values, changedAt: {} }, key + ":1"),
    };
    await db.setting.upsert({
      where: { key },
      create: { key, valueJson },
      update: { valueJson },
    });
    const role = await db.role.upsert({
      where: { code: "ADMIN" },
      update: {},
      create: { code: "ADMIN", name: "Admin" },
    });
    const user = await db.user.create({
      data: {
        email: "text-monitor-" + marker + "@example.test",
        emailVerified: new Date(),
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId: role.id } },
        customer: { create: { firstName: "Synthetic", phone: "+15555550123" } },
      },
      include: { customer: true },
    });
    users.push(user.id);
    const consent = await db.smsConsent.create({
      data: {
        customerId: user.customer!.id,
        environment: "sandbox",
        accountSid: values.TWILIO_ACCOUNT_SID,
        sender: values.TWILIO_FROM,
        phone: "+15555550123",
        timezone: "America/Chicago",
        consentVersion: "delivery-texts-v1",
        codeHash: randomBytes(32).toString("hex"),
        state: "ACTIVE",
        activatedAt: new Date(),
        expiresAt: new Date(),
      },
    });
    const order = await db.order.create({
      data: {
        number: "SMS-MONITOR-" + marker,
        customerId: user.customer!.id,
        status: "OUT_FOR_DELIVERY",
      },
    });
    await db.smsDelivery.create({
      data: {
        orderId: order.id,
        consentId: consent.id,
        environment: "sandbox",
        accountSid: values.TWILIO_ACCOUNT_SID,
        sender: values.TWILIO_FROM,
        phone: consent.phone,
        kind: "OUT_FOR_DELIVERY",
        status: "UNKNOWN",
        body: "Synthetic delivery text",
        attempts: 1,
        submittedAt: new Date(),
        issue: "SUBMISSION_UNCONFIRMED",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    expect((await page.request.get("/api/admin/delivery-texts")).status()).toBe(401);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(user.email!);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/deliveries/texts");
    await page.getByRole("button", { name: "Refresh delivery texts" }).click();
    await expect(
      page.getByRole("heading", { name: order.number, exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: order.number, exact: true }) })
        .getByText("Needs review: submission unconfirmed.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /resend|send again/i })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("delivery-text-monitor.png"),
      fullPage: true,
    });
  } finally {
    await db.user.updateMany({
      where: { id: { in: users } },
      data: { deletedAt: new Date() },
    });
    if (original)
      await db.setting.update({
        where: { key },
        data: { valueJson: original.valueJson! },
      });
    else await db.setting.deleteMany({ where: { key } });
    await db.$disconnect();
  }
});
