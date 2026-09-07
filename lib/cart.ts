import { addCents, multiplyCents, type Cents } from "@/lib/domain/money";

export const CART_STORAGE_KEY = "dd-cart-v1";
export const DEMO_ORDERS_STORAGE_KEY = "dd-demo-orders-v1";

export type CartLine = {
  variantId: string;
  productId: string;
  slug: string;
  productName: string;
  variantName: string;
  sku: string;
  brand: string;
  sizeLabel: string | null;
  scent: string | null;
  unitPriceCents: Cents;
  quantity: number;
  imageId: string | null;
};

export type CartSnapshot = {
  lines: CartLine[];
  updatedAt: string;
};

export function emptyCart(): CartSnapshot {
  return { lines: [], updatedAt: new Date(0).toISOString() };
}

export function lineTotalCents(
  line: Pick<CartLine, "unitPriceCents" | "quantity">,
): Cents {
  return multiplyCents(line.unitPriceCents, line.quantity);
}

export function cartSubtotalCents(
  lines: Pick<CartLine, "unitPriceCents" | "quantity">[],
): Cents {
  return addCents(...lines.map((line) => lineTotalCents(line)));
}

export function cartItemCount(lines: Pick<CartLine, "quantity">[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function upsertCartLine(
  lines: CartLine[],
  incoming: CartLine,
  maxQuantity = 24,
): CartLine[] {
  const quantity = Math.max(1, Math.min(maxQuantity, incoming.quantity));
  const index = lines.findIndex((line) => line.variantId === incoming.variantId);
  if (index === -1) {
    return [...lines, { ...incoming, quantity }];
  }
  const next = [...lines];
  const current = next[index];
  next[index] = {
    ...current,
    ...incoming,
    quantity: Math.max(1, Math.min(maxQuantity, current.quantity + incoming.quantity)),
  };
  return next;
}

export function setCartLineQuantity(
  lines: CartLine[],
  variantId: string,
  quantity: number,
  maxQuantity = 24,
): CartLine[] {
  if (quantity <= 0) {
    return lines.filter((line) => line.variantId !== variantId);
  }
  return lines.map((line) =>
    line.variantId === variantId
      ? { ...line, quantity: Math.max(1, Math.min(maxQuantity, quantity)) }
      : line,
  );
}

export function parseCartSnapshot(raw: string | null): CartSnapshot {
  if (!raw) return emptyCart();
  try {
    const parsed = JSON.parse(raw) as CartSnapshot;
    if (!parsed || !Array.isArray(parsed.lines)) return emptyCart();
    const lines = parsed.lines.filter(
      (line) =>
        typeof line?.variantId === "string" &&
        typeof line?.unitPriceCents === "number" &&
        Number.isInteger(line.unitPriceCents) &&
        typeof line?.quantity === "number" &&
        Number.isInteger(line.quantity) &&
        line.quantity > 0,
    );
    return { lines, updatedAt: parsed.updatedAt ?? new Date().toISOString() };
  } catch {
    return emptyCart();
  }
}

export const DEMO_DELIVERY_FEE_CENTS = 499;
export const DEMO_FREE_DELIVERY_CENTS = 3500;
export const DEMO_TAX_BPS = 700;

export function demoDeliveryFeeCents(subtotalCents: Cents): Cents {
  if (subtotalCents <= 0) return 0;
  return subtotalCents >= DEMO_FREE_DELIVERY_CENTS ? 0 : DEMO_DELIVERY_FEE_CENTS;
}

export function demoTaxCents(subtotalCents: Cents): Cents {
  if (subtotalCents <= 0) return 0;
  return Math.round((subtotalCents * DEMO_TAX_BPS) / 10_000);
}

export function demoOrderTotals(subtotalCents: Cents) {
  const deliveryFeeCents = demoDeliveryFeeCents(subtotalCents);
  const taxCents = demoTaxCents(subtotalCents);
  return {
    subtotalCents,
    deliveryFeeCents,
    taxCents,
    totalCents: addCents(subtotalCents, deliveryFeeCents, taxCents),
  };
}

export type DemoOrder = {
  id: string;
  placedAt: string;
  status: "confirmed" | "packing" | "out_for_delivery" | "delivered";
  email: string;
  name: string;
  phone: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
  };
  zoneName: string;
  lines: CartLine[];
  totals: ReturnType<typeof demoOrderTotals>;
  note?: string;
};

export function createDemoOrderId() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DD-DEMO-${stamp}-${suffix}`;
}

export const SAMPLE_ACCOUNT_ORDERS: DemoOrder[] = [
  {
    id: "DD-DEMO-20260828-HOME",
    placedAt: "2026-08-28T15:12:00.000Z",
    status: "delivered",
    email: "jamie@household.example",
    name: "Jamie Cole",
    phone: "515-555-0142",
    address: {
      line1: "1842 Cottage Grove Ave",
      city: "Des Moines",
      region: "IA",
      postalCode: "50314",
    },
    zoneName: "Des Moines core",
    lines: [
      {
        variantId: "sample-fresh-64",
        productId: "sample-fresh",
        slug: "fresh-breeze-liquid-detergent",
        productName: "Liquid Detergent · Fresh",
        variantName: "Liquid Detergent · Fresh · 64 oz",
        sku: "DD-LIQ-64-FRESH",
        brand: "Generic",
        sizeLabel: "64 oz",
        scent: "Fresh",
        unitPriceCents: 1299,
        quantity: 2,
        imageId: null,
      },
      {
        variantId: "sample-pods",
        productId: "sample-pods-p",
        slug: "free-and-clear-laundry-pods",
        productName: "Laundry Pods · Free & Clear",
        variantName: "Laundry Pods · Free & Clear · 42 ct",
        sku: "DD-POD-42-FREE",
        brand: "Generic",
        sizeLabel: "42 ct",
        scent: "Free & Clear",
        unitPriceCents: 1499,
        quantity: 1,
        imageId: null,
      },
    ],
    totals: demoOrderTotals(4097),
    note: "Sample order shown because this account has no live history yet.",
  },
  {
    id: "DD-DEMO-20260902-REST",
    placedAt: "2026-09-02T18:40:00.000Z",
    status: "out_for_delivery",
    email: "jamie@household.example",
    name: "Jamie Cole",
    phone: "515-555-0142",
    address: {
      line1: "1842 Cottage Grove Ave",
      city: "Des Moines",
      region: "IA",
      postalCode: "50314",
    },
    zoneName: "Des Moines core",
    lines: [
      {
        variantId: "sample-dish",
        productId: "sample-dish-p",
        slug: "citrus-burst-dish-soap",
        productName: "Dish Liquid · Citrus · 24 oz",
        variantName: "Dish Liquid · Citrus · 24 oz",
        sku: "DD-DSH-24-CITRUS",
        brand: "Generic",
        sizeLabel: "24 oz",
        scent: "Citrus",
        unitPriceCents: 399,
        quantity: 2,
        imageId: null,
      },
      {
        variantId: "sample-towels",
        productId: "sample-towels-p",
        slug: "everyday-paper-towels",
        productName: "Paper Towels · White · 6 pack",
        variantName: "Paper Towels · White · 6 pack",
        sku: "DD-PPR-6PK-WHT",
        brand: "Generic",
        sizeLabel: "6 pack",
        scent: "Unscented",
        unitPriceCents: 1299,
        quantity: 1,
        imageId: null,
      },
    ],
    totals: demoOrderTotals(2097),
    note: "Sample order shown because this account has no live history yet.",
  },
];
