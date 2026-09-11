import { expect, it } from "vitest";
import { catalogColumns, parseCatalogImport } from "./catalog-file";
import { parseCsv, writeCsv } from "./csv";
const row = [
  "detergent",
  "Laundry, fresh",
  "Local",
  "SKU-1",
  "Bucket",
  "12.34",
  "txcd_99999999",
  "2",
];
const csv = (rows = [row]) => writeCsv([catalogColumns, ...rows]);
it("reads quoted names and exact cents while grouping variants under one product", () => {
  const rows = parseCatalogImport(
    csv([row, [...row.slice(0, 3), "SKU-2", "Bottle", "4.1", ...row.slice(6)]]),
  );
  expect(rows.map((r) => [r.productKey, r.amountCents])).toEqual([
    ["detergent", 1234],
    ["detergent", 410],
  ]);
  expect(rows[0].productName).toBe("Laundry, fresh");
});
it("rejects duplicate SKUs, inconsistent groups and invalid amount/capacity/headers", () => {
  expect(() => parseCatalogImport(csv([row, row]))).toThrow("duplicate SKU");
  const changed = [...row];
  changed[1] = "Different product";
  changed[3] = "SKU-2";
  expect(() => parseCatalogImport(csv([row, changed]))).toThrow("must share");
  for (const [column, value] of [
    [5, "1e2"],
    [5, "0"],
    [5, "1.001"],
    [6, "unknown"],
    [7, "0"],
    [7, "1001"],
  ] as const) {
    const bad = [...row];
    bad[column] = value;
    expect(() => parseCatalogImport(csv([bad]))).toThrow();
  }
  expect(() => parseCatalogImport("sku\nSKU-1")).toThrow("template");
});
it("bounds input and rejects unterminated quotes and extra cells", () => {
  expect(() => parseCatalogImport("x".repeat(12001))).toThrow();
  expect(() => parseCsv('"broken')).toThrow();
  expect(() => parseCatalogImport(csv([[...row, "extra"]]))).toThrow();
});
it("quotes exports and neutralizes spreadsheet formula prefixes", () => {
  const encoded = writeCsv([["=SUM(1,2)", " @IMPORT", 'name"quoted', "normal"]]);
  expect(parseCsv(encoded)[0]).toEqual([
    "'=SUM(1,2)",
    "' @IMPORT",
    'name"quoted',
    "normal",
  ]);
});
