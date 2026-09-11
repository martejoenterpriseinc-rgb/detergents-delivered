import { afterEach, expect, it, vi } from "vitest";
import { getExpectedTwilioSignature } from "twilio";
import { validatedSmsWebhook } from "./twilio-client";
vi.mock("./vault", () => ({
  readManagedEnvironment: async () => ({
    APP_ENV: "development",
    AUTH_URL: "http://localhost:3000",
    DD_SANDBOX_TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
    DD_SANDBOX_TWILIO_AUTH_TOKEN: "synthetic-token",
    DD_SANDBOX_TWILIO_FROM: "+15555550100",
  }),
}));
const path = "/api/twilio/inbound",
  url = "http://localhost:3000" + path;
const fields = {
  AccountSid: "AC" + "a".repeat(32),
  MessageSid: "SM" + "b".repeat(32),
  From: "+15555550101",
  To: "+15555550100",
  Body: "STOP",
  FutureField: "included",
};
const signature = getExpectedTwilioSignature("synthetic-token", url, fields);
function request(
  body = new URLSearchParams(fields).toString(),
  sig = signature,
  target = url,
) {
  return new Request(target, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": sig,
      host: "untrusted.invalid",
    },
    body,
  });
}
afterEach(() => vi.restoreAllMocks());
it("verifies every field against the configured callback origin, not incoming host headers", async () => {
  expect((await validatedSmsWebhook(request(), path)).fields.FutureField).toBe(
    "included",
  );
});
it("rejects changed content, untrusted URL signatures, duplicate fields and query callbacks", async () => {
  await expect(
    validatedSmsWebhook(
      request(new URLSearchParams({ ...fields, Body: "START" }).toString()),
      path,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    validatedSmsWebhook(
      request(
        undefined,
        getExpectedTwilioSignature(
          "synthetic-token",
          "https://untrusted.invalid" + path,
          fields,
        ),
      ),
      path,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    validatedSmsWebhook(
      request(new URLSearchParams(fields).toString() + "&Body=STOP"),
      path,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    validatedSmsWebhook(request(undefined, signature, url + "?other=1"), path),
  ).rejects.toMatchObject({ status: 400 });
});
it("caps callback bodies before signature processing", async () => {
  await expect(
    validatedSmsWebhook(request("Body=" + "x".repeat(17000)), path),
  ).rejects.toMatchObject({ status: 413 });
});
