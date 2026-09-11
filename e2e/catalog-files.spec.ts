import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";
test("catalog file review, lost-response retry, exports and CPA isolation", async ({
  page,
}, info) => {
  const db = new PrismaClient({ log: [] }),
    marker = randomUUID(),
    users: string[] = [];
  const password = "Synthetic-Catalog-File-123",
    slug = "csv-" + marker;
  try {
    for (const code of ["ADMIN", "CPA"] as const) {
      const role = await db.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      const user = await db.user.create({
        data: {
          email: `csv-${code.toLowerCase()}-${marker}@example.test`,
          passwordHash: await bcrypt.hash(password, 4),
          userRoles: { create: { roleId: role.id } },
        },
      });
      users.push(user.id);
    }
    const login = async (role: string) => {
      await page.goto("/sign-in");
      await page
        .getByLabel("Email", { exact: true })
        .fill(`csv-${role}-${marker}@example.test`);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
    };
    expect(
      (await page.request.get("/api/admin/catalog-files?kind=catalog")).status(),
    ).toBe(401);
    await login("admin");
    await page.goto("/admin/import-export");
    const csv = `product_key,product_name,brand,sku,variant_name,retail_price_usd,tax_code,capacity_units\n${slug},Synthetic laundry,Local,${slug}-A,Bucket,12.34,txcd_99999999,2\n${slug},Synthetic laundry,Local,${slug}-B,Bottle,4.10,txcd_99999999,2`;
    await page
      .getByLabel("Catalog CSV file")
      .setInputFiles({
        name: "catalog.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
    await page.getByRole("button", { name: "Preview import", exact: true }).click();
    await expect(
      page.getByText("Review 1 new products and 2 variants", { exact: true }),
    ).toBeVisible();
    expect(await db.product.count({ where: { slug } })).toBe(0);
    await expect(
      page.getByRole("button", { name: "Import reviewed drafts" }),
    ).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page.screenshot({
      path: info.outputPath("catalog-file-preview.png"),
      fullPage: true,
    });
    await page.route("**/api/admin/catalog-files", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Import reviewed drafts" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
    expect(await db.product.count({ where: { slug } })).toBe(1);
    await page.unroute("**/api/admin/catalog-files");
    await page.getByRole("button", { name: "Import reviewed drafts" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Imported 1 draft products and 2 variants",
    );
    const product = await db.product.findUniqueOrThrow({
      where: { slug },
      include: { variants: { include: { inventoryBalance: true, prices: true } } },
    });
    expect(product).toMatchObject({ isActive: false, websiteVisible: false });
    expect(product.variants).toHaveLength(2);
    expect(
      product.variants.every(
        (v) => v.inventoryBalance?.onHandQty === 0 && v.prices.length === 1,
      ),
    ).toBe(true);
    await page.getByLabel("SKU prefix (optional)").fill(slug);
    const href = await page
      .getByRole("link", { name: "Export catalog CSV" })
      .getAttribute("href");
    const exported = await page.request.get(href!);
    expect(exported.status()).toBe(200);
    expect(await exported.text()).toContain('"12.34"');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("catalog-file-saved.png"),
      fullPage: true,
    });
    await page.context().clearCookies();
    await login("cpa");
    await page.goto("/admin/import-export");
    await expect(page.getByLabel("Catalog CSV file")).toHaveCount(0);
    expect((await page.request.get("/api/admin/catalog-files?kind=stock")).status()).toBe(
      200,
    );
    expect(
      (
        await page.request.post("/api/admin/catalog-files", {
          headers: { origin: "http://localhost:3000" },
          data: { action: "preview", csv },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await db.user.updateMany({
      where: { id: { in: users } },
      data: { deletedAt: new Date() },
    });
    await db.$disconnect();
  }
});
