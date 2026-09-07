import { describe, expect, it } from "vitest";
import {
  DEMO_GENERIC_BRAND,
  DEMO_PRODUCTS,
  demoCatalogSkus,
  demoCatalogUpcs,
} from "./demo-catalog-data";

const NAMED_BRANDS =
  /tide|gain|persil|dawn|downy|freshco|softday|sparkle home|house & hearth|brand a|detergents delivered/i;

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

  it("names products by type, scent, and size with no consumer brands", () => {
    expect(DEMO_PRODUCTS.every((product) => product.brand === DEMO_GENERIC_BRAND)).toBe(
      true,
    );
    expect(DEMO_PRODUCTS.every((product) => product.name.includes("·"))).toBe(true);
    const catalogText = DEMO_PRODUCTS.map(
      (product) =>
        `${product.name} ${product.brand} ${product.variants.map((variant) => variant.name).join(" ")}`,
    ).join(" ");
    expect(catalogText).not.toMatch(NAMED_BRANDS);
    expect(
      DEMO_PRODUCTS.some((product) => product.name.startsWith("Liquid Detergent")),
    ).toBe(true);
    expect(DEMO_PRODUCTS.some((product) => product.name.startsWith("Laundry Pods"))).toBe(
      true,
    );
    expect(DEMO_PRODUCTS.some((product) => product.name.startsWith("Dish Liquid"))).toBe(
      true,
    );
    expect(DEMO_PRODUCTS.some((product) => product.name.startsWith("Scent Beads"))).toBe(
      true,
    );
  });
});
