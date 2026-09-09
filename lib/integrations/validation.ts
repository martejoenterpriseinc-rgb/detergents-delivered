import { z } from "zod";
import { AccountError } from "@/lib/domain/account";
import {
  applicationOrigin,
  type IntegrationEnvironment,
} from "@/lib/integration-environment";
export const updateApiSchema = z
  .object({
    environment: z.enum(["sandbox", "live"]),
    provider: z.enum([
      "stripe",
      "google",
      "email",
      "sms",
      "quickbooks",
      "storage",
      "destination",
    ]),
    field: z.string().min(1).max(80),
    value: z
      .string()
      .trim()
      .min(1, "Enter a value. Cancel keeps the saved value.")
      .max(4096),
    version: z.number().int().min(0),
  })
  .strict();
export function validateApiValue(
  field: string,
  value: string,
  mode: IntegrationEnvironment,
  ownOrigin: string | null,
) {
  const invalid = (message: string) => {
    throw new AccountError(message);
  };
  if (/[\u0000-\u001f\u007f]/.test(value))
    invalid("Use a single line without control characters.");
  if (field === "APP_URL") {
    const origin = applicationOrigin(value);
    if (!origin || origin === ownOrigin || new URL(origin).hostname === "localhost")
      invalid(
        "Enter a separate HTTPS application address without a path, query or login details.",
      );
    return origin!;
  }
  if (/^STRIPE_(RESTRICTED|SECRET|PUBLISHABLE)_KEY$/.test(field)) {
    const prefix =
      field === "STRIPE_RESTRICTED_KEY"
        ? "rk"
        : field === "STRIPE_SECRET_KEY"
          ? "sk"
          : "pk";
    if (
      !new RegExp(
        `^${prefix}_${mode === "sandbox" ? "test" : "live"}_[A-Za-z0-9_-]+$`,
      ).test(value)
    )
      invalid(`Use a ${mode === "sandbox" ? "test" : "live"} key for this environment.`);
  }
  if (field === "STRIPE_ACCOUNT_ID" && !/^acct_[A-Za-z0-9]+$/.test(value))
    invalid("Use the Stripe account ID beginning acct_.");
  if (field === "STRIPE_WEBHOOK_SECRET" && !/^whsec_[A-Za-z0-9_-]+$/.test(value))
    invalid("Use the webhook signing secret beginning whsec_.");
  if (
    field === "GOOGLE_CLIENT_ID" &&
    !/^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(value)
  )
    invalid(
      "Use the Google web application client ID ending .apps.googleusercontent.com.",
    );
  if (field === "EMAIL_PROVIDER" && value !== "sendgrid")
    invalid("SendGrid is the supported email provider.");
  if (field === "EMAIL_FROM") {
    const address = value.match(/^(.*?)\s*<([^<>]+)>$/)?.[2] ?? value;
    if (!z.string().email().safeParse(address).success)
      invalid("Enter a verified sender email, optionally as Name <email@example.com>.");
  }
  if (field === "EMAIL_ALLOWED_RECIPIENTS") {
    const addresses = value.split(",").map((v) => v.trim().toLowerCase());
    if (
      addresses.length > 30 ||
      !addresses.every((v) => z.string().email().safeParse(v).success)
    )
      invalid("Enter up to 30 email addresses separated by commas.");
    return [...new Set(addresses)].join(",");
  }
  if (field === "TWILIO_ACCOUNT_SID" && !/^AC[a-f0-9]{32}$/i.test(value))
    invalid("Enter a valid Twilio Account SID.");
  if (field === "TWILIO_FROM" && !/^\+[1-9]\d{7,14}$/.test(value))
    invalid("Use an international number such as +12125551234.");
  if (field === "STORAGE_ENDPOINT" && !applicationOrigin(value))
    invalid("Enter an HTTPS storage origin.");
  if (field === "QUICKBOOKS_REALM_ID" && !/^\d+$/.test(value))
    invalid("Use the numeric QuickBooks company ID.");
  return value;
}
