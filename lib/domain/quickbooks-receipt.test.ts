import { describe, expect, it } from "vitest";
import { matchCashReceipt, prepareCashReceipt } from "./quickbooks-receipt";

const sale = {
  kind: "SALE",
  orderId: "order",
  sourceId: "order",
  customerId: "customer",
  number: "SYNTHETIC",
  date: "2026-02-01",
  currency: "USD",
  subtotalCents: 3000,
  promotionCents: 300,
  rewardsCents: 600,
  cashCents: 2268,
  netCents: 2100,
  taxCents: 168,
  taxSnapshotHash: "a".repeat(64),
  address: {
    line1: "1 Synthetic Street",
    line2: "",
    city: "Chicago",
    region: "IL",
    postalCode: "60601",
    country: "US",
  },
  lines: [
    {
      orderItemId: "one",
      variantId: "variant",
      quantity: 3,
      unitPriceCents: 1000,
      discountCents: 900,
      netCents: 2100,
      taxCents: 168,
    },
  ],
};
const mapping = {
  customerId: "customer",
  customerRef: { value: "12" },
  depositRef: { value: "13" },
  items: [{ variantId: "variant", itemRef: { value: "14" }, taxCode: "TAX" }],
};
const refund = {
  kind: "SETTLEMENT",
  orderId: "order",
  sourceId: "adjustment",
  customerId: "customer",
  date: "2026-02-02",
  currency: "USD",
  cashCents: 756,
  netCents: 700,
  taxCents: 56,
  rewardCents: 200,
  providerRefundId: "re_synthetic",
  taxEvidenceStatus: "MATCHED",
  taxEvidenceId: "evidence",
  originalTaxTransactionId: "tax_original",
  refundTaxTransactionId: "tax_refund",
  lines: [
    {
      orderItemId: "one",
      variantId: "variant",
      quantity: 1,
      netCents: 700,
      taxCents: 56,
      rewardCents: 200,
    },
  ],
};
const prepared = (isRefund = false) =>
  prepareCashReceipt({
    documentNumber: `D${isRefund ? "R" : "S"}${"a".repeat(19)}`,
    sale,
    mapping,
    ...(isRefund ? { refund } : {}),
  });
const response = (isRefund = false) => {
  const p = prepared(isRefund);
  return {
    [p.entity]: { ...structuredClone(p.payload), Id: "55", TotalAmt: p.cashCents / 100 },
  };
};

describe("original cash receipt evidence", () => {
  it("matches reordered item evidence by original item identity without accepting a duplicate", () => {
    const s = {
      ...sale,
      lines: [
        {
          ...sale.lines[0],
          quantity: 1,
          discountCents: 300,
          netCents: 700,
          taxCents: 56,
        },
        {
          ...sale.lines[0],
          orderItemId: "two",
          variantId: "second",
          quantity: 2,
          discountCents: 600,
          netCents: 1400,
          taxCents: 112,
        },
      ],
    };
    const p = prepareCashReceipt({
      documentNumber: `DS${"a".repeat(19)}`,
      sale: s,
      mapping: {
        ...mapping,
        items: [
          ...mapping.items,
          { variantId: "second", itemRef: { value: "15" }, taxCode: "TAX" },
        ],
      },
    });
    const r = {
      ...p.payload,
      Id: "55",
      TotalAmt: 22.68,
      Line: [...p.payload.Line].reverse(),
    };
    expect(matchCashReceipt({ SalesReceipt: r }, p)).toBe("55");
    expect(() =>
      matchCashReceipt({ SalesReceipt: { ...r, Line: [r.Line[0], r.Line[0]] } }, p),
    ).toThrow();
    expect(() =>
      matchCashReceipt({ RefundReceipt: r }, { ...p, entity: "RefundReceipt" }),
    ).toThrow();
  });
  it("uses original net lines without charging promotions or rewards again", () => {
    const p = prepared();
    expect(p.entity).toBe("SalesReceipt");
    expect(p.payload.Line[0].Amount).toBe(21);
    expect(p.payload.TxnTaxDetail.TotalTax).toBe(1.68);
    expect(p.cashCents).toBe(2268);
    expect(p.payload.Line[0].SalesItemLineDetail).not.toHaveProperty("UnitPrice");
    expect(matchCashReceipt(response(), p)).toBe("55");
  });
  it("exports only settled cash and keeps reward restoration out of the refund receipt", () => {
    const p = prepared(true);
    expect(p.entity).toBe("RefundReceipt");
    expect(p.cashCents).toBe(756);
    expect(p.payload.Line[0].Amount).toBe(7);
    expect(p.payload.TxnTaxDetail.TotalTax).toBe(0.56);
    expect(matchCashReceipt(response(true), p)).toBe("55");
  });
  it.each([
    { kind: "COMPENSATION" },
    { kind: "REWARD_ONLY" },
    { taxEvidenceStatus: "UNVERIFIED" },
    { taxEvidenceId: null },
    { originalTaxTransactionId: null },
    { refundTaxTransactionId: null },
    { providerRefundId: null },
    { cashCents: -756 },
    { cashCents: 0 },
    { cashCents: 956 },
    { rewardCents: 201 },
    { orderId: "another" },
    { customerId: "another" },
    { date: "2026-02-30" },
    { lines: [{ ...refund.lines[0], quantity: 4 }] },
    { lines: [{ ...refund.lines[0], variantId: "another" }] },
  ])("rejects unsupported or inconsistent refund evidence: %j", (change) => {
    expect(() =>
      prepareCashReceipt({
        documentNumber: `DR${"a".repeat(19)}`,
        sale,
        mapping,
        refund: { ...refund, ...change },
      }),
    ).toThrow();
  });
  it("requires complete, unambiguous original item links and preserves taxable zero-rate treatment", () => {
    for (const bad of [
      { ...mapping, customerId: "another" },
      { ...mapping, items: [] },
      { ...mapping, items: [...mapping.items, ...mapping.items] },
      { ...mapping, items: [{ ...mapping.items[0], taxCode: "NON" }] },
    ])
      expect(() =>
        prepareCashReceipt({ documentNumber: `DS${"a".repeat(19)}`, sale, mapping: bad }),
      ).toThrow();
    const zeroTaxSale = {
      ...sale,
      cashCents: 2100,
      taxCents: 0,
      lines: [{ ...sale.lines[0], taxCents: 0 }],
    };
    const p = prepareCashReceipt({
      documentNumber: `DS${"a".repeat(19)}`,
      sale: zeroTaxSale,
      mapping,
    });
    expect(p.payload.Line[0].SalesItemLineDetail.TaxCodeRef.value).toBe("TAX");
    expect(p.payload.TxnTaxDetail.TotalTax).toBe(0);
  });
  it("rejects a fabricated original sale, duplicated lines and a mismatched receipt prefix", () => {
    for (const s of [
      { ...sale, rewardsCents: 601 },
      { ...sale, sourceId: "different" },
      { ...sale, lines: [...sale.lines, ...sale.lines] },
      { ...sale, lines: [{ ...sale.lines[0], unitPriceCents: 1100 }] },
    ])
      expect(() =>
        prepareCashReceipt({ documentNumber: `DS${"a".repeat(19)}`, sale: s, mapping }),
      ).toThrow();
    expect(() =>
      prepareCashReceipt({ documentNumber: `DR${"a".repeat(19)}`, sale, mapping }),
    ).toThrow();
  });
  it("accepts only an exact computed trailing subtotal in addition to prepared lines", () => {
    const p = prepared();
    const line = { DetailType: "SubTotalLineDetail", Amount: 21, SubTotalLineDetail: {} };
    const raw = response().SalesReceipt;
    expect(
      matchCashReceipt({ SalesReceipt: { ...raw, Line: [...raw.Line, line] } }, p),
    ).toBe("55");
    for (const lines of [
      [line, ...raw.Line],
      [...raw.Line, { ...line, Amount: 30 }],
      [...raw.Line, line, line],
      [...raw.Line, { DetailType: "DiscountLineDetail", Amount: 0 }],
      [...raw.Line, raw.Line[0]],
    ])
      expect(() =>
        matchCashReceipt({ SalesReceipt: { ...raw, Line: lines } }, p),
      ).toThrow();
  });
  it.each([
    { TotalAmt: 22.69 },
    { TotalAmt: 22.681 },
    { TotalAmt: -22.68 },
    { TxnTaxDetail: { TotalTax: 1.69 } },
    { TxnTaxDetail: { TotalTax: 1.68, TaxLine: [{ Amount: 1.67 }] } },
    { CustomerRef: { value: "99" } },
    { DepositToAccountRef: { value: "99" } },
    { CurrencyRef: { value: "CAD" } },
    { TxnDate: "2026-02-02" },
    { DocNumber: `DS${"b".repeat(19)}` },
    { Balance: 1 },
    { ExchangeRate: 1.01 },
    { GlobalTaxCalculation: "TaxInclusive" },
    { ShipAddr: { Line1: "Another address" } },
  ])("holds a provider receipt with changed financial evidence: %j", (change) => {
    expect(() =>
      matchCashReceipt(
        { SalesReceipt: { ...response().SalesReceipt, ...change } },
        prepared(),
      ),
    ).toThrow();
  });
  it("rejects wrong entities, altered item links, altered amounts and duplicated business lines", () => {
    expect(() => matchCashReceipt(response(true), prepared())).toThrow();
    expect(() =>
      matchCashReceipt({ ...response(), ...response(true) }, prepared()),
    ).toThrow();
    const raw = response().SalesReceipt,
      line = raw.Line[0];
    for (const changed of [
      { ...line, Amount: 20.99 },
      { ...line, Description: "another" },
      {
        ...line,
        SalesItemLineDetail: { ...line.SalesItemLineDetail, ItemRef: { value: "99" } },
      },
      {
        ...line,
        SalesItemLineDetail: {
          ...line.SalesItemLineDetail,
          TaxCodeRef: { value: "NON" },
        },
      },
    ])
      expect(() =>
        matchCashReceipt({ SalesReceipt: { ...raw, Line: [changed] } }, prepared()),
      ).toThrow();
  });
});
