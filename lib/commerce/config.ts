import { AccountError } from "@/lib/domain/account";
export function commerceConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const key = env.STRIPE_RESTRICTED_KEY || env.STRIPE_SECRET_KEY;
  const live = env.APP_ENV === "production";
  const mode = live ? "live" : "test";
  const origin = env.AUTH_URL;
  const missing: string[] = [];
  if (!["development", "staging", "production"].includes(env.APP_ENV ?? ""))
    missing.push("Application environment");
  if (env.DD_CHECKOUT_ENABLED !== "true") missing.push("Checkout activation");
  if (!key || !new RegExp(`^(rk|sk)_${mode}_`).test(key))
    missing.push(`Stripe ${mode} server key`);
  if (!/^acct_[A-Za-z0-9]+$/.test(env.DD_STRIPE_ACCOUNT_ID ?? ""))
    missing.push("Stripe account identity");
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))
    missing.push("Stripe webhook signing secret");
  if (
    !origin ||
    (!origin.startsWith("https://") &&
      !(
        env.APP_ENV === "development" &&
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
      ))
  )
    missing.push("Application origin");
  if (live && env.DD_LIVE_CHECKOUT_ACCEPTED !== "true")
    missing.push("Production checkout acceptance");
  return {
    enabled: !missing.length,
    missing,
    live,
    key,
    accountId: env.DD_STRIPE_ACCOUNT_ID ?? "",
    origin: origin ?? "",
  };
}
export function requireCommerce(recovery = false) {
  const config = commerceConfiguration();
  const blocking = recovery
    ? config.missing.filter(
        (v) => !["Checkout activation", "Production checkout acceptance"].includes(v),
      )
    : config.missing;
  if (blocking.length)
    throw new AccountError("Ordering is not open yet. Please check back soon.", 503);
  return config;
}
