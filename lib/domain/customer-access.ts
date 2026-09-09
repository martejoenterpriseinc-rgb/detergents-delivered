import { z } from "zod";

export const accountEmailSchema = z.string().trim().toLowerCase().email().max(320);
export const newAccountPasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(72)
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    "Use no more than 72 bytes.",
  );
export const registerAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: accountEmailSchema,
    password: newAccountPasswordSchema,
    confirmPassword: z.string().max(72),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, "Passwords must match.");
export const resetPasswordSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    password: newAccountPasswordSchema,
    confirmPassword: z.string().max(72),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, "Passwords must match.");

export const RECOVERY_RESPONSE =
  "If an eligible account uses that email, you’ll receive a password reset link. Check your inbox and spam folder. If you use Google, choose Continue with Google instead.";

export function googleSignInConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  return Boolean(
    (env.GOOGLE_CLIENT_ID || env.AUTH_GOOGLE_ID)?.trim() &&
    (env.GOOGLE_CLIENT_SECRET || env.AUTH_GOOGLE_SECRET)?.trim(),
  );
}

// Never derive recovery links from a request Host or a supplied callback URL.
export function recoveryOrigin(env: Record<string, string | undefined> = process.env) {
  const url = new URL(env.AUTH_URL || env.NEXTAUTH_URL || "");
  const local =
    env.APP_ENV === "development" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    !(url.protocol === "https:" || (local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Configure a trusted public authentication origin.");
  }
  return url.origin;
}
