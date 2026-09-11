import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { catalogColumns } from "@/lib/domain/catalog-file";
import { writeCsv } from "@/lib/domain/csv";
import { previewCatalogFile, applyCatalogFile, exportCatalogFile } from "./catalog-file";
const marker = randomUUID(),
  users: string[] = [];
let admin: string, cpa: string, customer: string;
beforeAll(async () => {
  for (const code of ["ADMIN", "CPA", "CUSTOMER"] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const user = await prisma.user.create({
      data: {
        email: `catalog-file-${code.toLowerCase()}-${marker}@example.test`,
        userRoles: { create: { roleId: role.id } },
      },
    });
    users.push(user.id);
  }
  [admin, cpa, customer] = users;
});
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
const fixture = () => {
  const slug = "file-" + randomUUID();
  return {
    slug,
    csv: writeCsv([
      catalogColumns,
      [
        slug,
        "Synthetic catalog",
        "Local",
        slug + "-A",
        "Bucket",
        "12.34",
        "txcd_99999999",
        "2",
      ],
      [
        slug,
        "Synthetic catalog",
        "Local",
        slug + "-B",
        "Bottle",
        "4.10",
        "txcd_99999999",
        "2",
      ],
    ]),
  };
};
it("previews without writes and applies grouped draft products exactly once across retries", async () => {
  const f = fixture(),
    preview = await previewCatalogFile(admin, { csv: f.csv });
  expect(preview).toMatchObject({ products: 1, variants: 2 });
  expect(await prisma.product.count({ where: { slug: f.slug } })).toBe(0);
  const input = {
    csv: f.csv,
    requestKey: randomUUID(),
    previewHash: preview.previewHash,
    confirmed: true,
  };
  const results = await Promise.all([
    applyCatalogFile(admin, input),
    applyCatalogFile(admin, input),
  ]);
  expect(results[0]).toEqual(results[1]);
  const product = await prisma.product.findUniqueOrThrow({
    where: { slug: f.slug },
    include: {
      variants: {
        include: { prices: true, inventoryBalance: true, inventoryTxns: true },
      },
    },
  });
  expect(product).toMatchObject({
    isActive: false,
    websiteVisible: false,
    allowPreorder: false,
  });
  expect(product.variants).toHaveLength(2);
  for (const variant of product.variants) {
    expect(variant).toMatchObject({
      isActive: false,
      websiteVisible: false,
      inventoryBalance: { onHandQty: 0, reservedQty: 0 },
      inventoryTxns: [],
    });
    expect(variant.prices).toHaveLength(1);
  }
  expect(await exportCatalogFile(cpa, { kind: "catalog", prefix: f.slug })).toContain(
    '"12.34"',
  );
  expect(await exportCatalogFile(cpa, { kind: "stock", prefix: f.slug })).toContain(
    '"0","0","0"',
  );
});
it("rejects changed previews and existing keys without overwriting catalog or price history", async () => {
  const f = fixture(),
    preview = await previewCatalogFile(admin, { csv: f.csv });
  const input = {
    csv: f.csv,
    requestKey: randomUUID(),
    previewHash: preview.previewHash,
    confirmed: true,
  };
  await expect(
    applyCatalogFile(admin, { ...input, csv: f.csv.replace("12.34", "15.00") }),
  ).rejects.toMatchObject({ status: 409 });
  await applyCatalogFile(admin, input);
  await expect(
    applyCatalogFile(admin, { ...input, requestKey: randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
  const variants = await prisma.productVariant.findMany({
    where: { product: { slug: f.slug } },
    include: { prices: true },
  });
  expect(
    variants
      .flatMap((v) => v.prices)
      .map((p) => p.amountCents)
      .sort(),
  ).toEqual([1234, 410].sort());
});
it("rolls back all products, prices, balances and audits when the batch audit fails", async () => {
  const f = fixture(),
    preview = await previewCatalogFile(admin, { csv: f.csv });
  const input = {
    csv: f.csv,
    requestKey: randomUUID(),
    previewHash: preview.previewHash,
    confirmed: true,
  };
  await prisma.$executeRawUnsafe(
    "ALTER TABLE \"AuditLog\" ADD CONSTRAINT dd_catalog_audit CHECK (action <> 'catalog.import.completed') NOT VALID",
  );
  try {
    await expect(applyCatalogFile(admin, input)).rejects.toThrow();
    expect(await prisma.product.count({ where: { slug: f.slug } })).toBe(0);
    expect(
      await prisma.productVariant.count({ where: { sku: { startsWith: f.slug } } }),
    ).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT dd_catalog_audit',
    );
  }
  expect(await applyCatalogFile(admin, input)).toMatchObject({
    products: 1,
    variants: 2,
  });
});
it("enforces CPA/customer boundaries and serializes competing imports", async () => {
  const f = fixture(),
    preview = await previewCatalogFile(admin, { csv: f.csv });
  for (const actor of [cpa, customer]) {
    await expect(previewCatalogFile(actor, { csv: f.csv })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      applyCatalogFile(actor, {
        csv: f.csv,
        requestKey: randomUUID(),
        previewHash: preview.previewHash,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
  }
  await expect(exportCatalogFile(customer, { kind: "catalog" })).rejects.toMatchObject({
    status: 403,
  });
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      applyCatalogFile(admin, {
        csv: f.csv,
        requestKey: randomUUID(),
        previewHash: preview.previewHash,
        confirmed: true,
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await prisma.productVariant.count({ where: { product: { slug: f.slug } } }),
  ).toBe(2);
});
