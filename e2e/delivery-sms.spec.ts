import { randomUUID, randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { getExpectedTwilioSignature } from "twilio";
import { sealIntegration } from "../lib/integrations/secrets";
import "../tests/integration-guard";
test("delivery texts require explicit consent and a signed phone verification; STOP prevents reactivation", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    marker = randomUUID(),
    key = "integrations:v1:sandbox:sms",
    password = "Synthetic-Sms-Password-123",
    phone = "+15555550123";
  const values = {
    TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
    TWILIO_AUTH_TOKEN: "synthetic-browser-token",
    TWILIO_FROM: "+15555550100",
  };
  const original = await db.setting.findUnique({ where: { key } });
  let userId: string | undefined;
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
    const user = await db.user.create({
      data: {
        email: "sms-" + marker + "@example.test",
        emailVerified: new Date(),
        passwordHash: await bcrypt.hash(password, 4),
        customer: { create: { firstName: "Synthetic", phone } },
      },
      include: { customer: true },
    });
    userId = user.id;
    expect((await page.request.get("/api/account/sms-consent")).status()).toBe(401);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(user.email!);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.goto("/account/settings/notifications");
    const section = page.getByRole("region", { name: "Activate delivery texts" });
    const button = section.getByRole("button", { name: "Get verification instructions" });
    await expect(button).toBeDisabled();
    await section
      .getByLabel("Your time zone", { exact: true })
      .selectOption("America/Chicago");
    await section.getByRole("checkbox").check();
    await button.click();
    const status = section.getByRole("status");
    await expect(status).toContainText("DD ");
    const text = await status.innerText();
    const code = /DD [A-F0-9]{10}/.exec(text)![0];
    expect(
      JSON.stringify(
        await db.smsConsent.findFirst({ where: { customerId: user.customer!.id } }),
      ),
    ).not.toContain(code.slice(3));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("delivery-text-verification.png"),
      fullPage: true,
    });
    const callback = "http://localhost:3000/api/twilio/inbound";
    async function inbound(Body: string, valid = true) {
      const fields = {
        MessageSid: "SM" + randomBytes(16).toString("hex"),
        AccountSid: values.TWILIO_ACCOUNT_SID,
        From: phone,
        To: values.TWILIO_FROM,
        Body,
      };
      return page.request.post(callback, {
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": valid
            ? getExpectedTwilioSignature(values.TWILIO_AUTH_TOKEN, callback, fields)
            : "invalid",
        },
        data: new URLSearchParams(fields).toString(),
      });
    }
    expect((await inbound(code, false)).status()).toBe(403);
    expect((await inbound(code)).status()).toBe(204);
    await section.getByRole("button", { name: "Check phone verification" }).click();
    await expect(section.getByRole("status")).toHaveText(
      "Your phone is verified for delivery texts.",
    );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("delivery-text-active.png"),
      fullPage: true,
    });
    await page.getByLabel("Email delivery notifications", { exact: true }).check();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your phone is verified for delivery texts." }),
    ).toBeVisible();
    expect(
      (await (await page.request.get("/api/account/sms-consent")).json()).active,
    ).toBe(true);
    expect((await inbound("STOP")).status()).toBe(204);
    expect((await inbound(code)).status()).toBe(204);
    await page.reload();
    await expect(
      section.getByRole("button", { name: "Get verification instructions" }),
    ).toBeVisible();
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: user.customer!.id } }))
        .smsNotifications,
    ).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    if (userId)
      await db.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    if (original)
      await db.setting.update({
        where: { key },
        data: { valueJson: original.valueJson! },
      });
    else await db.setting.deleteMany({ where: { key } });
    await db.$disconnect();
  }
});
