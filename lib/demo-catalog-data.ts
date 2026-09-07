export type DemoProductForm = "LIQUID" | "POWDER" | "PODS" | "SHEETS" | "OTHER";

export type DemoVariantSpec = {
  sku: string;
  upc: string;
  name: string;
  scent: string;
  sizeLabel: string;
  sizeValue: number;
  sizeUnit: string;
  uom: string;
  casePack: number;
  reorderPoint: number;
  reorderQty: number;
  unitCostCents: number;
  retailCents: number;
  subscriptionCents: number;
};

export type DemoProductSpec = {
  slug: string;
  name: string;
  brand: string;
  description: string;
  categorySlug: string;
  form: DemoProductForm;
  featured: boolean;
  variants: DemoVariantSpec[];
};

export type DemoCategorySpec = {
  name: string;
  slug: string;
  description: string;
  parentSlug?: string;
};

export const DEMO_GENERIC_BRAND = "Generic";

export const DEMO_VENDOR = {
  name: "Midwest Household Supply",
  contactName: "Alex Rivera",
  email: "orders@midwest-household.example",
  phone: "555-0100",
  addressLine1: "100 Warehouse Rd",
  city: "Des Moines",
  region: "IA",
  postalCode: "50309",
  paymentTerms: "Net 15",
  notes: "Primary detergent wholesaler for the demo path.",
} as const;

export const DEMO_CATEGORIES: DemoCategorySpec[] = [
  {
    name: "Laundry",
    slug: "laundry",
    description: "Detergent, softener, and wash-day supplies",
  },
  {
    name: "Liquid detergent",
    slug: "liquid-detergent",
    description: "Bottled laundry detergent",
    parentSlug: "laundry",
  },
  {
    name: "Pods & powder",
    slug: "pods-powder",
    description: "Unit-dose and powder laundry",
    parentSlug: "laundry",
  },
  {
    name: "Dish",
    slug: "dish",
    description: "Hand dish and dishwasher supplies",
  },
  {
    name: "Home cleaners",
    slug: "home-cleaners",
    description: "All-purpose and surface cleaners",
  },
  {
    name: "Paper & extras",
    slug: "paper-extras",
    description: "Paper goods and household extras",
  },
];

export const DEMO_PRODUCTS: DemoProductSpec[] = [
  {
    slug: "fresh-breeze-liquid-detergent",
    name: "Liquid Detergent · Fresh",
    brand: DEMO_GENERIC_BRAND,
    description:
      "Everyday liquid detergent with a clean, airy scent. A household staple we keep in stock for weekly drop-offs.",
    categorySlug: "liquid-detergent",
    form: "LIQUID",
    featured: true,
    variants: [
      {
        sku: "DD-LIQ-64-FRESH",
        upc: "000000000001",
        name: "Liquid Detergent · Fresh · 64 oz",
        scent: "Fresh",
        sizeLabel: "64 oz",
        sizeValue: 64,
        sizeUnit: "oz",
        uom: "bottle",
        casePack: 6,
        reorderPoint: 6,
        reorderQty: 12,
        unitCostCents: 650,
        retailCents: 1299,
        subscriptionCents: 1199,
      },
      {
        sku: "DD-LIQ-128-FRESH",
        upc: "000000000011",
        name: "Liquid Detergent · Fresh · 128 oz",
        scent: "Fresh",
        sizeLabel: "128 oz",
        sizeValue: 128,
        sizeUnit: "oz",
        uom: "bottle",
        casePack: 4,
        reorderPoint: 4,
        reorderQty: 8,
        unitCostCents: 1090,
        retailCents: 2199,
        subscriptionCents: 1999,
      },
    ],
  },
  {
    slug: "lavender-liquid-detergent",
    name: "Liquid Detergent · Lavender · 100 oz",
    brand: DEMO_GENERIC_BRAND,
    description:
      "A calmer wash-day scent. Same reliable clean, bottled for busy households that want laundry done without a store run.",
    categorySlug: "liquid-detergent",
    form: "LIQUID",
    featured: true,
    variants: [
      {
        sku: "DD-LIQ-100-LAV",
        upc: "000000000002",
        name: "Liquid Detergent · Lavender · 100 oz",
        scent: "Lavender",
        sizeLabel: "100 oz",
        sizeValue: 100,
        sizeUnit: "oz",
        uom: "bottle",
        casePack: 4,
        reorderPoint: 4,
        reorderQty: 8,
        unitCostCents: 890,
        retailCents: 1699,
        subscriptionCents: 1549,
      },
    ],
  },
  {
    slug: "free-and-clear-laundry-pods",
    name: "Laundry Pods · Free & Clear",
    brand: DEMO_GENERIC_BRAND,
    description:
      "Unscented, dye-free pods for sensitive skin. Toss in the drum — we bring the next tub to your door.",
    categorySlug: "pods-powder",
    form: "PODS",
    featured: true,
    variants: [
      {
        sku: "DD-POD-42-FREE",
        upc: "000000000003",
        name: "Laundry Pods · Free & Clear · 42 ct",
        scent: "Free & Clear",
        sizeLabel: "42 ct",
        sizeValue: 42,
        sizeUnit: "ct",
        uom: "tub",
        casePack: 6,
        reorderPoint: 8,
        reorderQty: 12,
        unitCostCents: 720,
        retailCents: 1499,
        subscriptionCents: 1399,
      },
      {
        sku: "DD-POD-90-FREE",
        upc: "000000000012",
        name: "Laundry Pods · Free & Clear · 90 ct",
        scent: "Free & Clear",
        sizeLabel: "90 ct",
        sizeValue: 90,
        sizeUnit: "ct",
        uom: "tub",
        casePack: 4,
        reorderPoint: 4,
        reorderQty: 8,
        unitCostCents: 1420,
        retailCents: 2699,
        subscriptionCents: 2499,
      },
    ],
  },
  {
    slug: "original-powder-detergent",
    name: "Powder Detergent · Original · 93 oz",
    brand: DEMO_GENERIC_BRAND,
    description:
      "Classic powder for a deep clean and bright whites. A budget-friendly box that lasts through family laundry piles.",
    categorySlug: "pods-powder",
    form: "POWDER",
    featured: false,
    variants: [
      {
        sku: "DD-PWD-93-ORIG",
        upc: "000000000004",
        name: "Powder Detergent · Original · 93 oz",
        scent: "Original",
        sizeLabel: "93 oz",
        sizeValue: 93,
        sizeUnit: "oz",
        uom: "box",
        casePack: 3,
        reorderPoint: 3,
        reorderQty: 6,
        unitCostCents: 540,
        retailCents: 1099,
        subscriptionCents: 999,
      },
    ],
  },
  {
    slug: "meadow-soft-fabric-softener",
    name: "Fabric Softener · Meadow · 64 oz",
    brand: DEMO_GENERIC_BRAND,
    description:
      "Liquid softener that takes the crunch out of towels and sheets. Pair it with your usual detergent on the same delivery.",
    categorySlug: "laundry",
    form: "LIQUID",
    featured: true,
    variants: [
      {
        sku: "DD-SFT-64-MEADOW",
        upc: "000000000013",
        name: "Fabric Softener · Meadow · 64 oz",
        scent: "Meadow",
        sizeLabel: "64 oz",
        sizeValue: 64,
        sizeUnit: "oz",
        uom: "bottle",
        casePack: 6,
        reorderPoint: 6,
        reorderQty: 12,
        unitCostCents: 410,
        retailCents: 799,
        subscriptionCents: 729,
      },
    ],
  },
  {
    slug: "crisp-linen-dryer-sheets",
    name: "Dryer Sheets · Clean Linen · 120 ct",
    brand: DEMO_GENERIC_BRAND,
    description:
      "Static-taming dryer sheets with a light linen finish. A small box that belongs on every restock list.",
    categorySlug: "laundry",
    form: "SHEETS",
    featured: false,
    variants: [
      {
        sku: "DD-DRY-120-LINEN",
        upc: "000000000014",
        name: "Dryer Sheets · Clean Linen · 120 ct",
        scent: "Clean Linen",
        sizeLabel: "120 ct",
        sizeValue: 120,
        sizeUnit: "ct",
        uom: "box",
        casePack: 8,
        reorderPoint: 8,
        reorderQty: 16,
        unitCostCents: 280,
        retailCents: 549,
        subscriptionCents: 499,
      },
    ],
  },
  {
    slug: "citrus-burst-dish-soap",
    name: "Dish Liquid · Citrus · 24 oz",
    brand: DEMO_GENERIC_BRAND,
    description:
      "Grease-cutting dish liquid with a bright citrus smell. Keep a bottle at the sink and another under the cabinet — we will refill both.",
    categorySlug: "dish",
    form: "LIQUID",
    featured: true,
    variants: [
      {
        sku: "DD-DSH-24-CITRUS",
        upc: "000000000015",
        name: "Dish Liquid · Citrus · 24 oz",
        scent: "Citrus",
        sizeLabel: "24 oz",
        sizeValue: 24,
        sizeUnit: "oz",
        uom: "bottle",
        casePack: 12,
        reorderPoint: 12,
        reorderQty: 24,
        unitCostCents: 190,
        retailCents: 399,
        subscriptionCents: 349,
      },
    ],
  },
  {
    slug: "lemon-dishwasher-pods",
    name: "Dishwasher Pods · Lemon · 40 ct",
    brand: DEMO_GENERIC_BRAND,
    description:
      "One-pod dishwasher detergent. No pre-rinse lecture — just a clean machine and a lemon finish.",
    categorySlug: "dish",
    form: "PODS",
    featured: false,
    variants: [
      {
        sku: "DD-DWP-40-LEMON",
        upc: "000000000016",
        name: "Dishwasher Pods · Lemon · 40 ct",
        scent: "Lemon",
        sizeLabel: "40 ct",
        sizeValue: 40,
        sizeUnit: "ct",
        uom: "bag",
        casePack: 8,
        reorderPoint: 6,
        reorderQty: 12,
        unitCostCents: 520,
        retailCents: 1099,
        subscriptionCents: 999,
      },
    ],
  },
  {
    slug: "all-purpose-cleaner-fresh",
    name: "All-Purpose Cleaner · Fresh · 32 oz",
    brand: DEMO_GENERIC_BRAND,
    description:
      "A daily spray for counters, appliances, and sticky fingerprints. Household clean, without a warehouse-club haul.",
    categorySlug: "home-cleaners",
    form: "LIQUID",
    featured: false,
    variants: [
      {
        sku: "DD-APC-32-FRESH",
        upc: "000000000017",
        name: "All-Purpose Cleaner · Fresh · 32 oz",
        scent: "Fresh",
        sizeLabel: "32 oz",
        sizeValue: 32,
        sizeUnit: "oz",
        uom: "bottle",
        casePack: 12,
        reorderPoint: 8,
        reorderQty: 16,
        unitCostCents: 210,
        retailCents: 449,
        subscriptionCents: 399,
      },
    ],
  },
  {
    slug: "everyday-paper-towels",
    name: "Paper Towels · White · 6 pack",
    brand: DEMO_GENERIC_BRAND,
    description:
      "A 6-pack of sturdy paper towels. The kind of bulky item you never want to carry out of a store.",
    categorySlug: "paper-extras",
    form: "OTHER",
    featured: false,
    variants: [
      {
        sku: "DD-PPR-6PK-WHT",
        upc: "000000000018",
        name: "Paper Towels · White · 6 pack",
        scent: "Unscented",
        sizeLabel: "6 pack",
        sizeValue: 6,
        sizeUnit: "pk",
        uom: "pack",
        casePack: 4,
        reorderPoint: 6,
        reorderQty: 12,
        unitCostCents: 640,
        retailCents: 1299,
        subscriptionCents: 1199,
      },
    ],
  },
  {
    slug: "scent-beads-clean-linen",
    name: "Scent Beads · Clean Linen",
    brand: DEMO_GENERIC_BRAND,
    description:
      "In-wash scent beads for a light linen finish. Toss a capful in with the detergent — we will restock the jar on your porch.",
    categorySlug: "laundry",
    form: "OTHER",
    featured: false,
    variants: [
      {
        sku: "DD-BDS-13-LINEN",
        upc: "000000000019",
        name: "Scent Beads · Clean Linen · 13 oz",
        scent: "Clean Linen",
        sizeLabel: "13 oz",
        sizeValue: 13,
        sizeUnit: "oz",
        uom: "jar",
        casePack: 8,
        reorderPoint: 6,
        reorderQty: 12,
        unitCostCents: 320,
        retailCents: 699,
        subscriptionCents: 649,
      },
    ],
  },
];

export function demoCatalogSkus() {
  return DEMO_PRODUCTS.flatMap((product) =>
    product.variants.map((variant) => variant.sku),
  );
}

export function demoCatalogUpcs() {
  return DEMO_PRODUCTS.flatMap((product) =>
    product.variants.map((variant) => variant.upc),
  );
}
