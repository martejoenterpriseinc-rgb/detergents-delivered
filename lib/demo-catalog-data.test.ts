import { describe, expect, it } from "vitest";
import { DEMO_PRODUCTS, demoCatalogSkus, demoCatalogUpcs } from "./demo-catalog-data";

describe("demo catalog spec", () => {
  it("includes multiple household products with unique SKUs and UPCs", () => {
    expect(DEMO_PRODUCTS.length).toBeGreaterThanOrEqual(8);
    const slugs = DEMO_PRODUCTS.map((product) => product.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const skus = demoCatalogSkus();
    const upcs = demoCatalogUpcs();
    expect(skus.length).toBeGreaterThanOrEqual(10);
    expect(new Set(skus).size).toBe(skus.length);
    expect(new Set(upcs).size).toBe(upcs.length);
    expect(DEMO_PRODUCTS.some((product) => product.featured)).toBe(true);
    expect(DEMO_PRODUCTS.some((product) => product.categorySlug === "dish")).toBe(true);
    expect(skus).toContain("DD-LIQ-64-FRESH");
  });
});
