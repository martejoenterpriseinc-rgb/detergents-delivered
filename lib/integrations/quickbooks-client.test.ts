import { afterEach, expect, it, vi } from "vitest";
import {
  quickbooksAuthorizationUrl,
  exchangeQuickbooksToken,
  revokeQuickbooksToken,
  verifyQuickbooksCompany,
} from "./quickbooks-client";
const config = {
  mode: "sandbox" as const,
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  realm: "123",
  redirectUri: "https://dd.example.test/api/admin/quickbooks/callback",
  fingerprint: "synthetic",
};
afterEach(() => vi.unstubAllGlobals());
it("builds a fixed Intuit authorization URL with exact callback, state and accounting scope", () => {
  const url = new URL(quickbooksAuthorizationUrl(config, "synthetic-state"));
  expect(url.origin + url.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
  expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  expect(url.searchParams.get("state")).toBe("synthetic-state");
  expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
  expect(url.toString()).not.toContain(config.clientSecret);
});
it("exchanges and refreshes tokens against the fixed endpoint without redirects", async () => {
  const token = {
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
  };
  const call = vi.fn().mockImplementation(async () => Response.json(token));
  vi.stubGlobal("fetch", call);
  expect(await exchangeQuickbooksToken(config, { code: "synthetic-code" })).toEqual(
    token,
  );
  expect(call.mock.calls[0][0]).toBe(
    "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  );
  expect(call.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    cache: "no-store",
    method: "POST",
  });
  expect(new URLSearchParams(call.mock.calls[0][1].body).get("redirect_uri")).toBe(
    config.redirectUri,
  );
  await exchangeQuickbooksToken(config, { refreshToken: "synthetic-refresh" });
  expect(new URLSearchParams(call.mock.calls[1][1].body).get("grant_type")).toBe(
    "refresh_token",
  );
});
it("verifies the company through the selected environment and revokes using a fixed host", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ CompanyInfo: { Id: "1", CompanyName: "Synthetic company" } }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", call);
  expect(await verifyQuickbooksCompany(config, "synthetic-access")).toBe(
    "Synthetic company",
  );
  expect(call.mock.calls[0][0]).toBe(
    "https://sandbox-quickbooks.api.intuit.com/v3/company/123/companyinfo/123",
  );
  await revokeQuickbooksToken(config, "synthetic-refresh");
  expect(call.mock.calls[1][0]).toBe(
    "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  );
});
it("rejects provider errors and oversized or malformed responses without exposing their contents", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(new Response("private provider detail", { status: 401 }))
    .mockResolvedValueOnce(new Response("x".repeat(128001)))
    .mockResolvedValueOnce(Response.json({ access_token: "incomplete" }));
  vi.stubGlobal("fetch", call);
  await expect(
    exchangeQuickbooksToken(config, { code: "synthetic" }),
  ).rejects.toMatchObject({ status: 503 });
  await expect(
    exchangeQuickbooksToken(config, { code: "synthetic" }),
  ).rejects.toMatchObject({ status: 503 });
  await expect(exchangeQuickbooksToken(config, { code: "synthetic" })).rejects.toThrow();
});
