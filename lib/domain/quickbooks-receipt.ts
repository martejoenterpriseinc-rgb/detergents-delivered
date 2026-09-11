import { z } from "zod";
import { qboAmountCents } from "./quickbooks-expense";

const id = z.string().min(1).max(100);
const reference = z.object({ value: z.string().regex(/^\d{1,30}$/) });
const cents = z.number().int().min(0).max(100000000);
const money = z.number().refine((v) => v <= 1000000 && qboAmountCents(v) !== null);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const parsed = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
  });
const address = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200),
  city: z.string().min(1).max(100),
  region: z.string().regex(/^[A-Z]{2}$/),
  postalCode: z.string().regex(/^\d{5}(?:-\d{4})?$/),
  country: z.literal("US"),
});
const sourceLine = z.object({
  orderItemId: id,
  variantId: id,
  quantity: z.number().int().min(1).max(100),
  netCents: cents,
  taxCents: cents,
});
const saleSchema = z
  .object({
    kind: z.literal("SALE"),
    orderId: id,
    sourceId: id,
    customerId: id,
    number: id,
    date,
    currency: z.literal("USD"),
    subtotalCents: cents,
    promotionCents: cents,
    rewardsCents: cents,
    cashCents: cents.positive(),
    netCents: cents,
    taxCents: cents,
    taxSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    address,
    lines: z
      .array(sourceLine.extend({ unitPriceCents: cents, discountCents: cents }))
      .min(1)
      .max(30),
  })
  .refine(
    (s) =>
      s.sourceId === s.orderId &&
      s.cashCents === s.netCents + s.taxCents &&
      s.netCents === s.subtotalCents - s.promotionCents - s.rewardsCents &&
      s.lines.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0) ===
        s.subtotalCents &&
      s.lines.reduce((n, l) => n + l.discountCents, 0) ===
        s.promotionCents + s.rewardsCents &&
      s.lines.every(
        (l) => l.netCents === l.unitPriceCents * l.quantity - l.discountCents,
      ) &&
      s.lines.reduce((n, l) => n + l.netCents, 0) === s.netCents &&
      s.lines.reduce((n, l) => n + l.taxCents, 0) === s.taxCents &&
      new Set(s.lines.map((l) => l.orderItemId)).size === s.lines.length &&
      new Set(s.lines.map((l) => l.variantId)).size === s.lines.length,
  );
const refundSchema = z
  .object({
    kind: z.literal("SETTLEMENT"),
    orderId: id,
    sourceId: id,
    customerId: id,
    date,
    currency: z.literal("USD"),
    cashCents: cents.positive(),
    netCents: cents,
    taxCents: cents,
    rewardCents: cents,
    providerRefundId: id,
    taxEvidenceStatus: z.literal("MATCHED"),
    taxEvidenceId: id,
    originalTaxTransactionId: id,
    refundTaxTransactionId: id,
    lines: z
      .array(sourceLine.extend({ rewardCents: cents }))
      .min(1)
      .max(30),
  })
  .refine(
    (s) =>
      s.cashCents === s.netCents + s.taxCents &&
      s.lines.reduce((n, l) => n + l.netCents, 0) === s.netCents &&
      s.lines.reduce((n, l) => n + l.taxCents, 0) === s.taxCents &&
      s.lines.reduce((n, l) => n + l.rewardCents, 0) === s.rewardCents &&
      new Set(s.lines.map((l) => l.orderItemId)).size === s.lines.length,
  );
const mappingSchema = z
  .object({
    customerId: id,
    customerRef: reference,
    depositRef: reference,
    items: z
      .array(
        z
          .object({ variantId: id, itemRef: reference, taxCode: z.enum(["TAX", "NON"]) })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .refine((s) => new Set(s.items.map((i) => i.variantId)).size === s.items.length);
const shipAddress = z.object({
  Line1: z.string(),
  Line2: z.string().optional(),
  City: z.string(),
  CountrySubDivisionCode: z.string(),
  PostalCode: z.string(),
  Country: z.literal("US"),
});
const itemDetail = z.object({
  ItemRef: reference,
  TaxCodeRef: z.object({ value: z.enum(["TAX", "NON"]) }),
});
const receiptLine = z.object({
  Amount: money,
  Description: z.string().min(1).max(1000),
  DetailType: z.literal("SalesItemLineDetail"),
  SalesItemLineDetail: itemDetail,
});
export const cashReceiptPayload = z
  .object({
    DocNumber: z.string().regex(/^D[SR][a-f0-9]{19}$/),
    TxnDate: date,
    CurrencyRef: z.object({ value: z.literal("USD") }),
    CustomerRef: reference,
    DepositToAccountRef: reference,
    ShipAddr: shipAddress,
    TxnTaxDetail: z.object({ TotalTax: money }).strict(),
    Line: z.array(receiptLine).min(1).max(30),
  })
  .strict()
  .refine((p) => {
    const net = p.Line.reduce((n, l) => n + qboAmountCents(l.Amount)!, 0);
    const tax = qboAmountCents(p.TxnTaxDetail.TotalTax)!;
    return (
      net + tax > 0 &&
      net + tax <= 100000000 &&
      new Set(p.Line.map((l) => l.Description)).size === p.Line.length
    );
  });

// Inputs must come from the original-record service and a company-verified mapping.
// This pure compiler neither authorizes a post nor establishes provider tax acceptance.
export function prepareCashReceipt(input: {
  documentNumber: string;
  sale: unknown;
  refund?: unknown;
  mapping: unknown;
}) {
  const sale = saleSchema.parse(input.sale),
    mapping = mappingSchema.parse(input.mapping);
  const refund = input.refund === undefined ? null : refundSchema.parse(input.refund);
  const source = refund ?? sale,
    entity = refund ? "RefundReceipt" : "SalesReceipt";
  if (
    mapping.customerId !== sale.customerId ||
    (refund &&
      (refund.orderId !== sale.orderId ||
        refund.customerId !== sale.customerId ||
        refund.cashCents > sale.cashCents ||
        refund.rewardCents > sale.rewardsCents)) ||
    !input.documentNumber.startsWith(refund ? "DR" : "DS")
  )
    throw new Error("Receipt identity differs from its original sale.");
  const lines = [...source.lines]
    .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId))
    .map((l) => {
      const original = sale.lines.find((s) => s.orderItemId === l.orderItemId);
      const item = mapping.items.find((m) => m.variantId === l.variantId);
      if (
        !original ||
        !item ||
        l.variantId !== original.variantId ||
        l.quantity > original.quantity ||
        l.netCents > original.netCents ||
        l.taxCents > original.taxCents ||
        (original.taxCents > 0 && item.taxCode !== "TAX")
      )
        throw new Error("Receipt lines or tax treatment differ from the original sale.");
      return {
        Amount: l.netCents / 100,
        Description: `Order ${sale.number}; item ${l.orderItemId}`,
        DetailType: "SalesItemLineDetail" as const,
        SalesItemLineDetail: {
          ItemRef: item.itemRef,
          TaxCodeRef: { value: item.taxCode },
        },
      };
    });
  const a = sale.address;
  const payload = cashReceiptPayload.parse({
    DocNumber: input.documentNumber,
    TxnDate: source.date,
    CurrencyRef: { value: "USD" },
    CustomerRef: mapping.customerRef,
    DepositToAccountRef: mapping.depositRef,
    ShipAddr: {
      Line1: a.line1,
      ...(a.line2 ? { Line2: a.line2 } : {}),
      City: a.city,
      CountrySubDivisionCode: a.region,
      PostalCode: a.postalCode,
      Country: a.country,
    },
    TxnTaxDetail: { TotalTax: source.taxCents / 100 },
    Line: lines,
  });
  return { entity, payload, cashCents: source.cashCents, sourceId: source.sourceId };
}

// Accept only the requested entity, exact cash/tax/customer/account/address and each
// prepared net line. QBO may append a computed subtotal but no other financial line.
export function matchCashReceipt(raw: unknown, expectedRaw: unknown) {
  const expected = z
    .object({
      entity: z.enum(["SalesReceipt", "RefundReceipt"]),
      payload: cashReceiptPayload,
      cashCents: cents.positive(),
      sourceId: id,
    })
    .strict()
    .parse(expectedRaw);
  const envelope = z.record(z.string(), z.unknown()).parse(raw);
  if (
    envelope[expected.entity === "SalesReceipt" ? "RefundReceipt" : "SalesReceipt"] !==
    undefined
  )
    throw new Error("Receipt evidence contains the wrong entity.");
  const p = expected.payload;
  if (!p.DocNumber.startsWith(expected.entity === "SalesReceipt" ? "DS" : "DR"))
    throw new Error("Receipt document identity belongs to another entity.");
  const receipt = z
    .object({
      Id: z.string().regex(/^\d{1,30}$/),
      DocNumber: z.string(),
      TxnDate: z.string(),
      CurrencyRef: z.object({ value: z.string() }),
      CustomerRef: reference,
      DepositToAccountRef: reference,
      ShipAddr: shipAddress,
      TotalAmt: money,
      TxnTaxDetail: z.object({
        TotalTax: money,
        TaxLine: z
          .array(z.object({ Amount: money }))
          .max(100)
          .optional(),
      }),
      Line: z
        .array(
          z.discriminatedUnion("DetailType", [
            receiptLine,
            z.object({
              DetailType: z.literal("SubTotalLineDetail"),
              Amount: money,
              SubTotalLineDetail: z.object({}),
            }),
          ]),
        )
        .min(1)
        .max(31),
      Balance: money.optional(),
      DiscountAmt: money.optional(),
      DiscountRate: z.number().optional(),
      HomeTotalAmt: money.optional(),
      ExchangeRate: z.number().optional(),
      GlobalTaxCalculation: z
        .enum(["TaxExcluded", "TaxInclusive", "NotApplicable"])
        .optional(),
    })
    .parse(envelope[expected.entity]);
  const net = p.Line.reduce((n, l) => n + qboAmountCents(l.Amount)!, 0);
  const tax = qboAmountCents(p.TxnTaxDetail.TotalTax)!;
  const sameAddress =
    (Object.keys(p.ShipAddr) as (keyof typeof p.ShipAddr)[]).every(
      (k) => (receipt.ShipAddr[k] ?? "") === (p.ShipAddr[k] ?? ""),
    ) && (receipt.ShipAddr.Line2 ?? "") === (p.ShipAddr.Line2 ?? "");
  if (
    expected.cashCents !== net + tax ||
    receipt.DocNumber !== p.DocNumber ||
    receipt.TxnDate !== p.TxnDate ||
    receipt.CurrencyRef.value !== "USD" ||
    receipt.CustomerRef.value !== p.CustomerRef.value ||
    receipt.DepositToAccountRef.value !== p.DepositToAccountRef.value ||
    !sameAddress ||
    qboAmountCents(receipt.TotalAmt) !== expected.cashCents ||
    qboAmountCents(receipt.TxnTaxDetail.TotalTax) !== tax ||
    (receipt.Balance ?? 0) !== 0 ||
    (receipt.DiscountAmt ?? 0) !== 0 ||
    (receipt.DiscountRate ?? 0) !== 0 ||
    (receipt.HomeTotalAmt !== undefined &&
      qboAmountCents(receipt.HomeTotalAmt) !== expected.cashCents) ||
    (receipt.ExchangeRate ?? 1) !== 1 ||
    receipt.GlobalTaxCalculation === "TaxInclusive" ||
    (receipt.TxnTaxDetail.TaxLine !== undefined &&
      receipt.TxnTaxDetail.TaxLine.reduce((n, l) => n + qboAmountCents(l.Amount)!, 0) !==
        tax)
  )
    throw new Error("Receipt evidence differs from the prepared cash, tax or identity.");
  const items = receipt.Line.filter((l) => l.DetailType === "SalesItemLineDetail");
  const subtotals = receipt.Line.filter((l) => l.DetailType === "SubTotalLineDetail");
  if (
    items.length !== p.Line.length ||
    subtotals.length > 1 ||
    (subtotals.length === 1 &&
      (receipt.Line.at(-1)?.DetailType !== "SubTotalLineDetail" ||
        qboAmountCents(subtotals[0].Amount) !== net))
  )
    throw new Error("Receipt has additional or inconsistent accounting lines.");
  for (const line of p.Line) {
    const matches = items.filter((l) => l.Description === line.Description),
      found = matches[0];
    if (
      matches.length !== 1 ||
      qboAmountCents(found.Amount) !== qboAmountCents(line.Amount) ||
      found.SalesItemLineDetail.ItemRef.value !==
        line.SalesItemLineDetail.ItemRef.value ||
      found.SalesItemLineDetail.TaxCodeRef.value !==
        line.SalesItemLineDetail.TaxCodeRef.value
    )
      throw new Error("Receipt item evidence differs from the prepared source.");
  }
  return receipt.Id;
}
