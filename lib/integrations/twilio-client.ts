import { validateRequest } from "twilio";
import { readManagedEnvironment } from "./vault";
import {
  providerConfiguration,
  applicationOrigin,
  integrationEnvironment,
} from "@/lib/integration-environment";
import { AccountError } from "@/lib/domain/account";
export async function smsConfig() {
  const env = await readManagedEnvironment(["sms"]),
    mode = integrationEnvironment(env),
    origin = applicationOrigin(env.AUTH_URL, env.APP_ENV === "development"),
    { values } = providerConfiguration("sms", env);
  const accountSid = values.TWILIO_ACCOUNT_SID,
    authToken = values.TWILIO_AUTH_TOKEN,
    sender = values.TWILIO_FROM;
  if (
    !mode ||
    !origin ||
    !/^AC[a-f0-9]{32}$/i.test(accountSid ?? "") ||
    !authToken ||
    !/^\+[1-9]\d{7,14}$/.test(sender ?? "")
  )
    throw new AccountError("Delivery texts are not available yet.", 503);
  return { mode, origin, accountSid: accountSid!, authToken, sender: sender! };
}
export async function validatedSmsWebhook(request: Request, path: string) {
  const config = await smsConfig();
  if (
    request.method !== "POST" ||
    request.headers.get("content-type")?.split(";")[0] !==
      "application/x-www-form-urlencoded" ||
    new URL(request.url).search
  )
    throw new AccountError("Invalid callback.", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError("Invalid callback.", 400);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) throw new AccountError("Callback too large.", 413);
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const params = new URLSearchParams(Buffer.concat(parts).toString("utf8"));
  const fields: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(fields, key))
      throw new AccountError("Duplicate callback field.", 400);
    fields[key] = value;
  }
  if (
    !validateRequest(
      config.authToken,
      request.headers.get("x-twilio-signature") ?? "",
      config.origin + path,
      fields,
    ) ||
    fields.AccountSid !== config.accountSid
  )
    throw new AccountError("Invalid callback signature.", 403);
  return { config, fields };
}
