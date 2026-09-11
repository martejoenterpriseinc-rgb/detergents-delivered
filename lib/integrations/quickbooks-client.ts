import { z } from "zod";
import { createHash } from "node:crypto";
import { AccountError } from "@/lib/domain/account";
import { readManagedEnvironment } from "./vault";
import {
  providerConfiguration,
  applicationOrigin,
  integrationEnvironment,
} from "@/lib/integration-environment";
import { canSealIntegrations } from "./secrets";

export async function quickbooksConfig() {
  const env = await readManagedEnvironment(["quickbooks"]);
  const mode = integrationEnvironment(env),
    origin = applicationOrigin(env.AUTH_URL, env.APP_ENV === "development"),
    { values } = providerConfiguration("quickbooks", env);
  const clientId = values.QUICKBOOKS_CLIENT_ID,
    clientSecret = values.QUICKBOOKS_CLIENT_SECRET,
    realm = values.QUICKBOOKS_REALM_ID;
  if (
    !mode ||
    !origin ||
    !clientId ||
    !clientSecret ||
    !/^\d{1,30}$/.test(realm ?? "") ||
    !canSealIntegrations(env)
  )
    throw new AccountError(
      "Save this environment's QuickBooks app credentials and intended company ID first.",
      503,
    );
  const redirectUri = origin + "/api/admin/quickbooks/callback";
  return {
    mode,
    clientId,
    clientSecret,
    realm,
    redirectUri,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([mode, clientId, clientSecret, realm, redirectUri]))
      .digest("hex"),
  };
}
export type QuickbooksConfig = Awaited<ReturnType<typeof quickbooksConfig>>;
export const quickbooksTokenSchema = z.object({
  access_token: z.string().min(1).max(16000),
  refresh_token: z.string().min(1).max(16000),
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
  expires_in: z.number().int().positive().max(86400),
  x_refresh_token_expires_in: z.number().int().positive().optional(),
});
export function quickbooksAuthorizationUrl(config: QuickbooksConfig, state: string) {
  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: config.redirectUri,
    state,
  }).toString();
  return url.toString();
}
async function providerRequest(url: string, init: RequestInit, empty = false) {
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error();
    if (empty) return {};
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128000) {
        await reader.cancel();
        throw new Error();
      }
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new AccountError(
      "QuickBooks could not confirm this operation. Reconnect or retry the indicated action.",
      503,
    );
  }
}
const basic = (c: QuickbooksConfig) =>
  "Basic " + Buffer.from(c.clientId + ":" + c.clientSecret).toString("base64");
export async function verifyQuickbooksCompany(
  config: QuickbooksConfig,
  accessToken: string,
) {
  const host =
    config.mode === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  const response = await providerRequest(
    `${host}/v3/company/${config.realm}/companyinfo/${config.realm}`,
    {
      method: "GET",
      headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
    },
  );
  return z
    .object({
      CompanyInfo: z.object({
        Id: z.string().min(1),
        CompanyName: z.string().min(1).max(200),
      }),
    })
    .parse(response).CompanyInfo.CompanyName;
}
export async function exchangeQuickbooksToken(
  config: QuickbooksConfig,
  input: { code: string } | { refreshToken: string },
) {
  const body: Record<string, string> =
    "code" in input
      ? {
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: config.redirectUri,
        }
      : { grant_type: "refresh_token", refresh_token: input.refreshToken };
  return quickbooksTokenSchema.parse(
    await providerRequest("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        Authorization: basic(config),
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    }),
  );
}
export async function revokeQuickbooksToken(
  config: QuickbooksConfig,
  refreshToken: string,
) {
  await providerRequest(
    "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    {
      method: "POST",
      headers: {
        Authorization: basic(config),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: refreshToken }),
    },
    true,
  );
}
