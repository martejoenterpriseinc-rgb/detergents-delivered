import { z } from "zod";
import { parseCsv } from "./csv";
import { AccountError } from "./account";

export const catalogColumns = [
  "product_key",
  "product_name",
  "brand",
  "sku",
  "variant_name",
  "retail_price_usd",
  "tax_code",
  "capacity_units",
];
const rowSchema = z
  .object({
    product_key: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    product_name: z.string().min(1).max(150),
    brand: z.string().min(1).max(100),
    sku: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .max(80),
    variant_name: z.string().min(1).max(100),
    retail_price_usd: z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/),
    tax_code: z.string().regex(/^txcd_\d{8}$/),
    capacity_units: z.string().regex(/^\d{1,4}$/),
  })
  .strict();
export function parseCatalogImport(csv: string) {
  const rows = parseCsv(csv, { bytes: 12_000, rows: 100, columns: 8, cell: 200 });
  const headers = rows.shift();
  if (
    !headers ||
    headers.length !== catalogColumns.length ||
    new Set(headers).size !== headers.length ||
    catalogColumns.some((c) => !headers.includes(c))
  )
    throw new AccountError("Use the catalog template with all eight columns.", 422);
  if (!rows.length) throw new AccountError("Add at least one catalog row.", 422);
  const skus = new Set<string>(),
    products = new Map<string, string>();
  return rows.map((row, i) => {
    if (row.length !== headers.length)
      throw new AccountError(
        `Row ${i + 2}: column count does not match the template.`,
        422,
      );
    const parsed = rowSchema.safeParse(
      Object.fromEntries(headers.map((h, n) => [h, row[n].trim()])),
    );
    if (!parsed.success)
      throw new AccountError(
        `Row ${i + 2}: check ${String(parsed.error.issues[0]?.path[0] ?? "fields")}.`,
        422,
      );
    const r = parsed.data;
    const [whole, fraction = ""] = r.retail_price_usd.split(".");
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    const capacityUnits = Number(r.capacity_units);
    if (
      amountCents <= 0 ||
      amountCents > 100_000_000 ||
      capacityUnits < 1 ||
      capacityUnits > 1000
    )
      throw new AccountError(
        `Row ${i + 2}: enter a positive price and capacity from 1 to 1,000.`,
        422,
      );
    if (skus.has(r.sku.toLowerCase()))
      throw new AccountError(`Row ${i + 2}: duplicate SKU.`, 422);
    skus.add(r.sku.toLowerCase());
    const group = JSON.stringify([r.product_name, r.brand, r.tax_code, capacityUnits]);
    if (products.has(r.product_key) && products.get(r.product_key) !== group)
      throw new AccountError(
        `Row ${i + 2}: rows for one product must share its name, brand, tax code and capacity.`,
        422,
      );
    products.set(r.product_key, group);
    return {
      productKey: r.product_key,
      productName: r.product_name,
      brand: r.brand,
      sku: r.sku,
      variantName: r.variant_name,
      amountCents,
      taxCode: r.tax_code,
      capacityUnits,
    };
  });
}
