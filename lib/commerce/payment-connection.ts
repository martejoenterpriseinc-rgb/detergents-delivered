import Stripe from "stripe";
import { runtimeCommerceConfiguration } from "./runtime";
export async function paymentConnection() {
  const config = await runtimeCommerceConfiguration();
  const checkedAt = new Date().toISOString();
  const disconnected = {
    connected: false,
    checkedAt,
    availableCents: null,
    pendingCents: null,
  };
  if (
    !config.key ||
    !/^acct_[A-Za-z0-9]+$/.test(config.accountId ?? "") ||
    !new RegExp(`^(sk|rk)_${config.live ? "live" : "test"}_`).test(config.key)
  )
    return {
      ...disconnected,
      message:
        "Stripe is not connected. Add the matching account and API key in Integrations.",
    };
  try {
    const stripe = new Stripe(config.key, {
      apiVersion: "2026-08-26.dahlia",
      timeout: 5000,
      maxNetworkRetries: 0,
    });
    const [account, balance] = await Promise.all([
      stripe.accounts.retrieve(null),
      stripe.balance.retrieve(),
    ]);
    if (account.id !== config.accountId || balance.livemode !== config.live)
      throw Error("Identity mismatch");
    const current = await runtimeCommerceConfiguration();
    if (
      current.key !== config.key ||
      current.accountId !== config.accountId ||
      current.live !== config.live
    )
      throw Error("Configuration changed");
    return {
      connected: true,
      checkedAt,
      message: "Stripe API connected",
      availableCents: balance.available
        .filter((b) => b.currency === "usd")
        .reduce((n, b) => n + b.amount, 0),
      pendingCents: balance.pending
        .filter((b) => b.currency === "usd")
        .reduce((n, b) => n + b.amount, 0),
    };
  } catch {
    return {
      ...disconnected,
      message:
        "Stripe connection interrupted or access denied. Check the account, key and API permissions.",
    };
  }
}
