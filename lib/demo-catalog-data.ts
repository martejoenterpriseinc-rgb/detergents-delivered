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

export const DEMO_VENDOR = {
  name: "Midwest Household Supply",
  contactName: "Alex Rivera",
  email: "orders@midwest-household.example",
  phone: "555-0100",
  addressLine1: "100 Warehouse Rd",
  city: "Crystal Lake",
  region: "IL",
  postalCode: "60014",
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
    name: "Fresh Breeze liquid detergent",
    brand: "Detergents Delivered",
    description:
      "Everyday liquid detergent with a clean, airy scent. A household staple we keep in stock for weekly drop-offs.",
    categorySlug: "liquid-detergent",
    form: "LIQUID",
    featured: true,
    variants: [
      {
        sku: "DD-LIQ-64-FRESH",
        upc: "000000000001",
        name: "64 oz Fresh Breeze",
        scent: "Fresh Breeze",
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
        name: "128 oz Fresh Breeze",
        scent: "Fresh Breeze",
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
    name: "Lavender liquid detergent",
    brand: "Detergents Delivered",
    description:
      "A calmer wash-day scent. Same reliable clean, bottled for busy households that want laundry done without a store run.",
    categorySlug: "liquid-detergent",
    form: "LIQUID",
    featured: true,
    variants: [
      {
        sku: "DD-LIQ-100-LAV",
        upc: "000000000002",
        name: "100 oz Lavender",
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
    name: "Free & Clear laundry pods",
    brand: "Detergents Delivered",
    description:
      "Unscented, dye-free pods for sensitive skin. Toss in the drum — we bring the next tub to your door.",
    categorySlug: "pods-powder",
    form: "PODS",
    featured: true,
    variants: [
      {
        sku: "DD-POD-42-FREE",
        upc: "000000000003",
        name: "42-count Free & Clear pods",
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
        name: "90-count Free & Clear pods",
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
    name: "Original powder detergent",
    brand: "Detergents Delivered",
    description:
      "Classic powder for a deep clean and bright whites. A budget-friendly jug that lasts through family laundry piles.",
    categorySlug: "pods-powder",
    form: "POWDER",
    featured: false,
    variants: [
      {
        sku: "DD-PWD-93-ORIG",
        upc: "000000000004",
        name: "93 oz Original powder",
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
    name: "Meadow Soft fabric softener",
    brand: "SoftDay",
    description:
      "Liquid softener that takes the crunch out of towels and sheets. Pair it with your usual detergent on the same delivery.",
    categorySlug: "laundry",
    form: "LIQUID",
    featured: true,
    variants: [
      {
        sku: "DD-SFT-64-MEADOW",
        upc: "000000000013",
        name: "64 oz Meadow Soft",
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
    name: "Crisp Linen dryer sheets",
    brand: "SoftDay",
    description:
      "Static-taming dryer sheets with a light linen finish. A small box that belongs on every restock list.",
    categorySlug: "laundry",
    form: "SHEETS",
    featured: false,
    variants: [
      {
        sku: "DD-DRY-120-LINEN",
        upc: "000000000014",
        name: "120-count Crisp Linen sheets",
        scent: "Crisp Linen",
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
    name: "Citrus Burst dish soap",
    brand: "Sparkle Home",
    description:
      "Grease-cutting dish soap with a bright citrus smell. Keep a bottle at the sink and another under the cabinet — we will refill both.",
    categorySlug: "dish",
    form: "LIQUID",
    featured: true,
    variants: [
      {
        sku: "DD-DSH-24-CITRUS",
        upc: "000000000015",
        name: "24 oz Citrus Burst",
        scent: "Citrus Burst",
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
    name: "Lemon dishwasher pods",
    brand: "Sparkle Home",
    description:
      "One-pod dishwasher detergent. No pre-rinse lecture — just a clean machine and a lemon finish.",
    categorySlug: "dish",
    form: "PODS",
    featured: false,
    variants: [
      {
        sku: "DD-DWP-40-LEMON",
        upc: "000000000016",
        name: "40-count Lemon dishwasher pods",
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
    name: "All-purpose cleaner",
    brand: "Sparkle Home",
    description:
      "A daily spray for counters, appliances, and sticky fingerprints. Household clean, without a warehouse-club haul.",
    categorySlug: "home-cleaners",
    form: "LIQUID",
    featured: false,
    variants: [
      {
        sku: "DD-APC-32-FRESH",
        upc: "000000000017",
        name: "32 oz Fresh clean spray",
        scent: "Fresh Clean",
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
    name: "Everyday paper towels",
    brand: "House & Hearth",
    description:
      "A 6-pack of sturdy paper towels. The kind of bulky item you never want to carry out of a store.",
    categorySlug: "paper-extras",
    form: "OTHER",
    featured: false,
    variants: [
      {
        sku: "DD-PPR-6PK-WHT",
        upc: "000000000018",
        name: "6-pack Everyday towels",
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
