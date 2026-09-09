import "../tests/integration-guard";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import sharp from "sharp";

test("product photos survive refresh and a lost save response without publishing private drafts", async ({
  page,
}, testInfo) => {
  const db = new PrismaClient({ log: [] });
  const email = `media-${randomUUID()}@example.test`,
    password = "Synthetic-Media-Password-123";
  const sku = `MEDIA-${randomUUID()}`;
  let ownerId: string | undefined, productId: string | undefined;
  try {
    const role = await db.role.upsert({
      where: { code: "ADMIN" },
      update: {},
      create: { code: "ADMIN", name: "Admin" },
    });
    ownerId = (
      await db.user.create({
        data: {
          email,
          passwordHash: await bcrypt.hash(password, 4),
          userRoles: { create: { roleId: role.id } },
        },
      })
    ).id;
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/shop/new");
    await page.getByLabel("Title", { exact: true }).fill("Synthetic photo product");
    await page.getByLabel("SKU", { exact: true }).fill(sku);
    await page
      .getByLabel("Description", { exact: true })
      .fill("Durable photo acceptance.");
    await page.getByLabel("Selling price ($)", { exact: true }).fill("35.00");
    await page.getByLabel("Regular retail price ($)", { exact: true }).fill("40.00");
    const first = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#21715a" },
    })
      .jpeg()
      .toBuffer();
    await page
      .getByLabel("Product image (JPEG or PNG, up to 4 MB)")
      .setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: first });
    await page
      .getByRole("button", { name: "Save inventory product", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/products\//);
    productId = (await db.productVariant.findUniqueOrThrow({ where: { sku } })).productId;
    const prior = await db.productImage.findFirstOrThrow({ where: { productId } });
    expect(prior.storageKey).toMatch(/^db\/catalog\/sandbox\//);
    expect((await page.request.get(`/api/catalog/media/${prior.id}`)).status()).toBe(404);
    await expect(page.getByText("Current photo", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Synthetic photo product", exact: true }),
    ).toBeVisible();
    const replacement = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#2954a8" },
    })
      .png()
      .toBuffer();
    await page.getByLabel("File", { exact: true }).setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: replacement,
    });
    let dropResponse = true;
    await page.route(`**/api/products/${productId}/images`, async (route) => {
      if (route.request().method() !== "POST" || !dropResponse) return route.continue();
      dropResponse = false;
      const saved = await route.fetch();
      expect(saved.status()).toBe(201);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic response lost; retry the same photo." }),
      });
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic response lost" }),
    ).toBeVisible();
    expect(
      await page
        .getByLabel("File", { exact: true })
        .evaluate((input: HTMLInputElement) => input.files?.length),
    ).toBe(1);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Photo saved");
    expect(await db.productImage.count({ where: { productId } })).toBe(2);
    expect(await db.productImage.count({ where: { productId, isPrimary: true } })).toBe(
      1,
    );
    await page.reload();
    await expect(page.getByText("Current photo", { exact: true })).toBeVisible();
    await expect(page.getByText("Previous photo", { exact: true })).toBeVisible();
    for (const photo of await db.productImage.findMany({ where: { productId } })) {
      const response = await page.request.get(
        `/api/products/${productId}/images/${photo.id}`,
      );
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect((await page.request.get(`/api/catalog/media/${photo.id}`)).status()).toBe(
        404,
      );
    }
    await page.screenshot({
      path: testInfo.outputPath("product-photos.png"),
      fullPage: true,
    });
    await page.goto("/admin/integrations");
    await expect(
      page.getByRole("heading", { name: "Background jobs & photo storage" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  } finally {
    if (!productId)
      productId = (await db.productVariant.findUnique({ where: { sku } }))?.productId;
    if (productId) {
      const images = await db.productImage.findMany({
        where: { productId },
        select: { storageKey: true },
      });
      await db.productImage.deleteMany({ where: { productId } });
      await db.operationalMedia.deleteMany({
        where: { key: { in: images.map((i) => i.storageKey) } },
      });
      await db.productPrice.deleteMany({ where: { productVariant: { productId } } });
      await db.productVariant.deleteMany({ where: { productId } });
      await db.product.delete({ where: { id: productId } });
    }
    if (ownerId) {
      await db.auditLog.deleteMany({ where: { actorUserId: ownerId } });
      await db.user.delete({ where: { id: ownerId } });
    }
    await db.$disconnect();
  }
});
