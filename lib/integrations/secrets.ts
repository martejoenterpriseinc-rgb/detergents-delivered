import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { AccountError } from "@/lib/domain/account";
type Env = Record<string, string | undefined>;
export type Sealed = { keyId: string; ciphertext: string };

// Purpose-separated subkeys from a retained hosting keyring. Never use an
// authentication cookie secret, persist a master key in the DB, or log plaintext.
function keyring(env: Env) {
  const dedicated = Boolean(env.DD_INTEGRATION_KEYS || env.DD_INTEGRATION_ACTIVE_KEY);
  try {
    const keys: Record<string, string> = JSON.parse(
      (dedicated ? env.DD_INTEGRATION_KEYS : env.DD_BUSINESS_DOCUMENT_KEYS) ?? "{}",
    );
    const active =
      (dedicated ? env.DD_INTEGRATION_ACTIVE_KEY : env.DD_BUSINESS_DOCUMENT_ACTIVE_KEY) ??
      "";
    if (
      !keys[active] ||
      !Object.entries(keys).every(
        ([id, value]) =>
          /^[a-zA-Z0-9_-]{1,40}$/.test(id) &&
          typeof value === "string" &&
          /^[a-f0-9]{64}$/i.test(value),
      )
    )
      throw new Error();
    return { keys, active, prefix: dedicated ? "api:" : "retained:" };
  } catch {
    throw new AccountError(
      "Secure API saving needs a retained encryption key in hosting settings.",
      503,
    );
  }
}
export function canSealIntegrations(env: Env = process.env) {
  try {
    keyring(env);
    return true;
  } catch {
    return false;
  }
}
function derived(raw: string, context: string) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(raw, "hex"),
      Buffer.from("DD-integrations-v1"),
      Buffer.from(context),
      32,
    ),
  );
}
export function sealIntegration(
  value: unknown,
  context: string,
  env: Env = process.env,
): Sealed {
  const { keys, active, prefix } = keyring(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derived(keys[active], context), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    keyId: prefix + active,
    ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"),
  };
}
export function openIntegration(
  value: Sealed,
  context: string,
  env: Env = process.env,
): unknown {
  try {
    const [source, id] = value.keyId.split(":");
    if (!["api", "retained"].includes(source) || !id) throw new Error();
    const keys = JSON.parse(
      (source === "api" ? env.DD_INTEGRATION_KEYS : env.DD_BUSINESS_DOCUMENT_KEYS) ??
        "{}",
    );
    if (!/^[a-f0-9]{64}$/i.test(keys[id] ?? "")) throw new Error();
    const data = Buffer.from(value.ciphertext, "base64");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      derived(keys[id], context),
      data.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8"),
    );
  } catch {
    throw new AccountError(
      "Saved API configuration could not be unlocked. Restore its retained encryption key before making changes.",
      503,
    );
  }
}
