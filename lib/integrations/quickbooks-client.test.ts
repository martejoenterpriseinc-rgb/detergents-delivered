import { afterEach, expect, it, vi } from "vitest";
import {
  readQuickbooksSalesEntity,
  readQuickbooksSalesEntities,
  createQuickbooksCostJournal,
  findQuickbooksCostJournal,
  quickbooksAuthorizationUrl,
  exchangeQuickbooksToken,
  revokeQuickbooksToken,
  verifyQuickbooksCompany,
  readQuickbooksAccounts,
  readQuickbooksAccount,
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
it("reads a bounded chart page and strips balances from account choices", async () => {
  const account = {
    Id: "1",
    Name: "Synthetic supplies",
    AccountType: "Expense",
    Active: true,
    CurrencyRef: { value: "USD" },
    CurrentBalance: 999,
  };
  const call = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ QueryResponse: { Account: [account] } }))
    .mockResolvedValueOnce(Response.json({ Account: account }));
  vi.stubGlobal("fetch", call);
  const result = await readQuickbooksAccounts(config, "synthetic-access", 101);
  expect(result.accounts[0]).not.toHaveProperty("CurrentBalance");
  expect(result.nextStart).toBeNull();
  expect(new URL(call.mock.calls[0][0]).searchParams.get("query")).toContain(
    "startposition 101 maxresults 100",
  );
  expect(await readQuickbooksAccount(config, "synthetic-access", "1")).not.toHaveProperty(
    "CurrentBalance",
  );
  await expect(
    readQuickbooksAccount(config, "synthetic-access", "1/other"),
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(2);
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

it("uses one fixed journal POST and a bounded read-only exact-reference query", async () => {
  const call = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic lost response"))
    .mockResolvedValueOnce(Response.json({ QueryResponse: { JournalEntry: [] } }));
  vi.stubGlobal("fetch", call);
  await expect(
    createQuickbooksCostJournal(config, "synthetic-access", { synthetic: true }),
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0][0]).toBe(
    "https://sandbox-quickbooks.api.intuit.com/v3/company/123/journalentry",
  );
  expect(call.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error" });
  const doc = "DC" + "a".repeat(19);
  expect(await findQuickbooksCostJournal(config, "synthetic-access", doc)).toEqual([]);
  expect(new URL(call.mock.calls[1][0]).searchParams.get("query")).toBe(
    "select * from JournalEntry where DocNumber = '" + doc + "' maxresults 2",
  );
  await expect(
    findQuickbooksCostJournal(config, "synthetic-access", "' or 1=1"),
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(2);
});

it("bounds sales-entity reads and exposes only the fields needed for record mapping", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        QueryResponse: {
          Customer: [
            {
              Id: "1",
              DisplayName: "Synthetic customer",
              Active: true,
              CurrencyRef: { value: "USD" },
              PrimaryEmailAddr: { Address: "private@example.test" },
              Balance: 999,
            },
          ],
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        Item: {
          Id: "2",
          Name: "Synthetic item",
          Active: true,
          Type: "NonInventory",
          IncomeAccountRef: { value: "9" },
          PurchaseCost: 999,
        },
      }),
    );
  vi.stubGlobal("fetch", call);
  const customers = await readQuickbooksSalesEntities(
    config,
    "synthetic-access",
    "customer",
    1,
  );
  expect(customers.rows).toEqual([
    {
      kind: "customer",
      id: "1",
      name: "Synthetic customer",
      active: true,
      currency: "USD",
    },
  ]);
  expect(
    await readQuickbooksSalesEntity(config, "synthetic-access", "item", "2"),
  ).toEqual({
    kind: "item",
    id: "2",
    name: "Synthetic item",
    active: true,
    type: "NonInventory",
    tracksQuantity: false,
    incomeAccountId: "9",
  });
  await expect(
    readQuickbooksSalesEntities(config, "synthetic-access", "customer", 0),
  ).rejects.toThrow();
  await expect(
    readQuickbooksSalesEntity(config, "synthetic-access", "item", "2/other"),
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(2);
});
