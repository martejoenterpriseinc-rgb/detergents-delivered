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
export async function createQuickbooksExpense(
  config: QuickbooksConfig,
  accessToken: string,
  payload: unknown,
) {
  const host =
    config.mode === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  return z.object({ Purchase: z.unknown() }).parse(
    await providerRequest(`${host}/v3/company/${config.realm}/purchase`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  ).Purchase;
}
export async function findQuickbooksExpense(
  config: QuickbooksConfig,
  accessToken: string,
  docNumber: string,
) {
  if (!/^DD[a-f0-9]{19}$/.test(docNumber))
    throw new AccountError("Invalid export reference.");
  const host =
    config.mode === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  const url = new URL(`${host}/v3/company/${config.realm}/query`);
  url.searchParams.set(
    "query",
    `select * from Purchase where DocNumber = '${docNumber}' maxresults 2`,
  );
  return (
    z
      .object({
        QueryResponse: z.object({ Purchase: z.array(z.unknown()).max(2).optional() }),
      })
      .parse(
        await providerRequest(url.toString(), {
          method: "GET",
          headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
        }),
      ).QueryResponse.Purchase ?? []
  );
}
export async function createQuickbooksCostJournal(
  config: QuickbooksConfig,
  accessToken: string,
  payload: unknown,
) {
  const host =
    config.mode === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  return z.object({ JournalEntry: z.unknown() }).parse(
    await providerRequest(`${host}/v3/company/${config.realm}/journalentry`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  ).JournalEntry;
}
export async function findQuickbooksCostJournal(
  config: QuickbooksConfig,
  accessToken: string,
  docNumber: string,
) {
  if (!/^DC[a-f0-9]{19}$/.test(docNumber))
    throw new AccountError("Invalid export reference.");
  const host =
    config.mode === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  const url = new URL(`${host}/v3/company/${config.realm}/query`);
  url.searchParams.set(
    "query",
    `select * from JournalEntry where DocNumber = '${docNumber}' maxresults 2`,
  );
  return (
    z
      .object({
        QueryResponse: z.object({ JournalEntry: z.array(z.unknown()).max(2).optional() }),
      })
      .parse(
        await providerRequest(url.toString(), {
          method: "GET",
          headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
        }),
      ).QueryResponse.JournalEntry ?? []
  );
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
const accountSchema = z.object({
  Id: z.string().regex(/^\d{1,30}$/),
  Name: z.string().min(1).max(200),
  AccountType: z.string().min(1).max(80),
  Active: z.boolean(),
  CurrencyRef: z.object({ value: z.string() }).optional(),
});
export type QuickbooksAccount = z.infer<typeof accountSchema>;
export async function readQuickbooksAccounts(
  config: QuickbooksConfig,
  accessToken: string,
  start: number,
) {
  const host =
    config.mode === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  const url = new URL(`${host}/v3/company/${config.realm}/query`);
  url.searchParams.set(
    "query",
    `select * from Account where Active = true startposition ${start} maxresults 100`,
  );
  const response = await providerRequest(url.toString(), {
    method: "GET",
    headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
  });
  const rows =
    z
      .object({
        QueryResponse: z.object({ Account: z.array(accountSchema).max(100).optional() }),
      })
      .parse(response).QueryResponse.Account ?? [];
  return { accounts: rows, nextStart: rows.length === 100 ? start + 100 : null };
}
export async function readQuickbooksAccount(
  config: QuickbooksConfig,
  accessToken: string,
  id: string,
) {
  if (!/^\d{1,30}$/.test(id)) throw new AccountError("Choose a valid account.");
  const host =
    config.mode === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  return z.object({ Account: accountSchema }).parse(
    await providerRequest(`${host}/v3/company/${config.realm}/account/${id}`, {
      method: "GET",
      headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
    }),
  ).Account;
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
