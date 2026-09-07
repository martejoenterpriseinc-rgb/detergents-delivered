import { describe, expect, it } from "vitest";
import {
  isShopProductForm,
  productFormLabel,
  storefrontBrandLabel,
} from "./product-display";

describe("product display", () => {
  it("labels forms as types, not brands", () => {
    expect(productFormLabel("LIQUID")).toBe("Liquid");
    expect(productFormLabel("PODS")).toBe("Pods");
    expect(isShopProductForm("LIQUID")).toBe(true);
    expect(isShopProductForm("Tide")).toBe(false);
  });

  it("hides Generic and empty brands on the storefront", () => {
    expect(storefrontBrandLabel("Generic")).toBeNull();
    expect(storefrontBrandLabel("")).toBeNull();
    expect(storefrontBrandLabel("generic")).toBeNull();
  });
});
