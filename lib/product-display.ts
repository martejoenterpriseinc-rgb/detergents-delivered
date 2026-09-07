export const PRODUCT_FORM_LABELS = {
  LIQUID: "Liquid",
  POWDER: "Powder",
  PODS: "Pods",
  SHEETS: "Sheets",
  OTHER: "Other",
} as const;

export type ShopProductForm = keyof typeof PRODUCT_FORM_LABELS;

export function productFormLabel(form: string | null | undefined) {
  if (!form) return "Household";
  return PRODUCT_FORM_LABELS[form as ShopProductForm] ?? "Household";
}

export function isShopProductForm(value: string | undefined): value is ShopProductForm {
  return Boolean(value && value in PRODUCT_FORM_LABELS);
}

export function storefrontBrandLabel(brand: string | null | undefined) {
  const trimmed = brand?.trim();
  if (!trimmed || trimmed.toLowerCase() === "generic") return null;
  return trimmed;
}
