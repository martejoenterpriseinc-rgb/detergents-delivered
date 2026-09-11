import { z } from "zod";
import type { smsConfig } from "./twilio-client";
type Config = Awaited<ReturnType<typeof smsConfig>>;
export class SmsRateLimit extends Error {}
export const smsReceipt = z.object({
  sid: z.string().regex(/^SM[a-f0-9]{32}$/i),
  account_sid: z.string(),
  from: z.string(),
  to: z.string(),
  body: z.string(),
  status: z.enum([
    "accepted",
    "queued",
    "sending",
    "sent",
    "delivered",
    "undelivered",
    "failed",
    "canceled",
  ]),
});
async function request(config: Config, path: string, body?: URLSearchParams) {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages${path}.json`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(config.accountSid + ":" + config.authToken).toString("base64"),
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(body ? { body: body.toString() } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (response.status === 429) throw new SmsRateLimit("Provider rate limit.");
  if (!response.ok) throw new Error("SMS provider response unavailable.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty provider response.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) throw new Error("Provider response too large.");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return smsReceipt.parse(JSON.parse(Buffer.concat(parts).toString("utf8")));
}
export async function submitDeliveryText(
  config: Config,
  id: string,
  phone: string,
  body: string,
) {
  z.uuid().parse(id);
  return request(
    config,
    "",
    new URLSearchParams({
      To: phone,
      From: config.sender,
      Body: body,
      StatusCallback: config.origin + "/api/twilio/status/" + id,
    }),
  );
}
export async function readDeliveryText(config: Config, sid: string) {
  z.string()
    .regex(/^SM[a-f0-9]{32}$/i)
    .parse(sid);
  return request(config, "/" + sid);
}
