import { afterEach, expect, it, vi } from "vitest";
import {
  createQuickbooksCashReceipt,
  findQuickbooksCashReceipt,
  readQuickbooksReceiptCompany,
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
it("reads receipt company facts without exposing unrelated company information or assuming missing currency", async () => {
  let missing = false;
  const call = vi.fn().mockImplementation(async (url: string) =>
    Response.json(
      url.endsWith("preferences")
        ? {
            Preferences: {
              CurrencyPrefs: missing ? {} : { HomeCurrency: { value: "USD" } },
              TaxPrefs: { UsingSalesTax: true },
              EmailMessagesPrefs: { hidden: "private" },
            },
          }
        : {
            CompanyInfo: {
              Country: "US",
              CompanyName: "Private name",
              Email: { Address: "private@example.test" },
            },
          },
    ),
  );
  vi.stubGlobal("fetch", call);
  expect(await readQuickbooksReceiptCompany(config, "synthetic-access")).toEqual({
    country: "US",
    homeCurrency: "USD",
    usingSalesTax: true,
    partnerTaxEnabled: null,
  });
  expect(call.mock.calls.map((c) => c[0]).sort()).toEqual([
    "https://sandbox-quickbooks.api.intuit.com/v3/company/123/companyinfo/123",
    "https://sandbox-quickbooks.api.intuit.com/v3/company/123/preferences",
  ]);
  expect(
    call.mock.calls.every((c) => c[1].method === "GET" && c[1].redirect === "error"),
  ).toBe(true);
  missing = true;
  await expect(
    readQuickbooksReceiptCompany(config, "synthetic-access"),
  ).rejects.toThrow();
});
afterEach(() => vi.unstubAllGlobals());
it("uses bounded receipt endpoints and entity-bound document queries without retrying a POST", async () => {
  const payload = {
    DocNumber: "DS" + "a".repeat(19),
    TxnDate: "2026-02-01",
    CurrencyRef: { value: "USD" },
    CustomerRef: { value: "1" },
    DepositToAccountRef: { value: "2" },
    ShipAddr: {
      Line1: "1 Synthetic",
      City: "Synthetic",
      CountrySubDivisionCode: "IL",
      PostalCode: "60000",
      Country: "US",
    },
    TxnTaxDetail: { TotalTax: 1.68 },
    Line: [
      {
        Amount: 21,
        Description: "Synthetic original item",
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { ItemRef: { value: "3" }, TaxCodeRef: { value: "TAX" } },
      },
    ],
  };
  const call = vi
    .fn()
    .mockRejectedValueOnce(new Error("Synthetic transport interruption"))
    .mockResolvedValueOnce(
      Response.json({
        QueryResponse: { SalesReceipt: [{ ...payload, Id: "4", TotalAmt: 22.68 }] },
      }),
    );
  vi.stubGlobal("fetch", call);
  await expect(
    createQuickbooksCashReceipt(config, "synthetic", "SalesReceipt", payload),
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0][0]).toBe(
    "https://sandbox-quickbooks.api.intuit.com/v3/company/123/salesreceipt",
  );
  expect(call.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error" });
  const rows = await findQuickbooksCashReceipt(
    config,
    "synthetic",
    "SalesReceipt",
    payload.DocNumber,
  );
  expect(rows).toHaveLength(1);
  expect(new URL(call.mock.calls[1][0]).searchParams.get("query")).toBe(
    `select * from SalesReceipt where DocNumber = '${payload.DocNumber}' maxresults 2`,
  );
  await expect(
    findQuickbooksCashReceipt(config, "synthetic", "RefundReceipt", payload.DocNumber),
  ).rejects.toThrow();
  await expect(
    findQuickbooksCashReceipt(config, "synthetic", "SalesReceipt", "' OR true"),
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(2);
});
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
