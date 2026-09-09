import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import "../tests/integration-guard";

test("builder publishes photos and sections with faithful device previews and protected drafts", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const db = new PrismaClient({ log: [] });
  const marker = randomUUID(),
    title = `Local essentials ${marker.slice(0, 8)}`;
  const headers = { origin: "http://localhost:3000" };
  const device = testInfo.project.name === "desktop" ? "computer" : testInfo.project.name;
  const width = device === "computer" ? 1440 : device === "tablet" ? 768 : 390;
  const height = device === "computer" ? 900 : device === "tablet" ? 1024 : 844;
  const visitor = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: "block",
  });
  const publicPage = await visitor.newPage();
  let original: {
    page: { sections: unknown[]; settings: unknown; version: number };
    draft: unknown;
  } | null = null;
  try {
    expect((await page.request.get("/api/admin/site/pages/home")).status()).toBe(401);
    const role = await db.role.upsert({
      where: { code: "ADMIN" },
      update: {},
      create: { code: "ADMIN", name: "Admin" },
    });
    const email = `website-${marker}@example.test`,
      password = "Synthetic-Website-Password-123";
    await db.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId: role.id } },
      },
    });
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    original = await (await page.request.get("/api/admin/site/pages/home")).json();
    await page.goto("/admin/website/builder");
    const iframe = page.frameLocator("iframe");
    await page.getByRole("button", { name: new RegExp(`^${device}$`, "i") }).click();
    await expect
      .poll(() => iframe.locator("body").evaluate(() => window.innerWidth))
      .toBe(width);
    await page.getByLabel("Selected area").selectOption("hero");
    await page.getByLabel("Heading", { exact: true }).fill(title);
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/website\/builder$/);
    await expect(page.getByRole("alert")).toContainText("unsaved changes");
    await expect(page.getByLabel("Heading", { exact: true })).toHaveValue(title);
    const bytes = await sharp({
      create: {
        width: 80,
        height: 60,
        channels: 3,
        background: { r: 12, g: 110, b: 145 },
      },
    })
      .png()
      .toBuffer();
    await page.getByLabel("Upload photo", { exact: true }).setInputFiles({
      name: "synthetic-photo.png",
      mimeType: "image/png",
      buffer: bytes,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Photo uploaded" }),
    ).toBeVisible();
    await page
      .getByLabel("Photo description", { exact: true })
      .fill("Synthetic website fixture");
    const horizontal = page.getByRole("slider", {
      name: "Photo horizontal position",
      exact: true,
    });
    const mobileVertical = page.getByRole("slider", {
      name: "Mobile photo vertical position",
      exact: true,
    });
    await horizontal.press("Home");
    await mobileVertical.press("End");
    for (let step = 0; step < 20; step++) {
      await horizontal.press("ArrowRight");
      await mobileVertical.press("ArrowLeft");
    }
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Draft saved" }),
    ).toBeVisible();
    const saved = await (await page.request.get("/api/admin/site/pages/home")).json();
    const imageId = saved.draft.sections.find(
      (s: { sectionId: string }) => s.sectionId === "hero",
    ).imageId;
    expect((await publicPage.request.get(`/api/site/media/${imageId}`)).status()).toBe(
      404,
    );
    await publicPage.goto("/");
    await expect(publicPage.getByRole("heading", { name: title })).toHaveCount(0);
    await page.reload();
    await page.getByLabel("Selected area").selectOption("hero");
    await expect(page.getByLabel("Heading", { exact: true })).toHaveValue(title);
    await page.getByRole("button", { name: new RegExp(`^${device}$`, "i") }).click();
    await expect(iframe.getByRole("heading", { name: title })).toBeVisible();
    // Section selection comes from the page itself, including shared site chrome.
    await iframe.locator("footer").click();
    await expect(page.getByLabel("Selected area")).toHaveValue("footer");
    await page
      .getByLabel("Footer description")
      .fill("A saved local delivery storefront.");
    const crossOrigin = await page.request.put("/api/admin/site/pages/home", {
      headers: { origin: "https://attacker.example" },
      data: {
        document: saved.draft,
        version: saved.page.version,
        requestKey: randomUUID(),
        mode: "publish",
      },
    });
    expect(crossOrigin.status()).toBe(403);
    // A failed response must keep the editor's text and never show a success state.
    await page.route("**/api/admin/site/pages/home", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Injected save failure" }),
          })
        : route.continue(),
    );
    await page.getByRole("button", { name: "Save & apply", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Injected save failure");
    await expect(page.getByLabel("Footer description")).toHaveValue(
      "A saved local delivery storefront.",
    );
    await page.unroute("**/api/admin/site/pages/home");
    await page.getByRole("button", { name: "Save & apply", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved and applied" }),
    ).toBeVisible();
    await publicPage.reload();
    await expect(publicPage.getByRole("heading", { name: title })).toBeVisible();
    await expect(publicPage.locator("footer")).toContainText(
      "A saved local delivery storefront.",
    );
    const media = await publicPage.request.get(`/api/site/media/${imageId}`);
    expect(media.status()).toBe(200);
    expect(media.headers()["content-type"]).toBe("image/webp");
    await expect(publicPage.getByAltText("Synthetic website fixture")).toBeVisible();
    await expect
      .poll(() =>
        publicPage
          .getByAltText("Synthetic website fixture")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.getByLabel("Click to edit", { exact: true }).uncheck();
    await iframe.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(iframe.getByRole("heading", { name: title })).toBeVisible();
    await expect
      .poll(() => iframe.locator("body").evaluate(() => window.innerWidth))
      .toBe(width);
    for (const selector of [
      ".sf-header",
      ".sf-hero h1",
      ".sf-hero .sf-section-photo",
      ".sf-footer",
    ]) {
      const local = await iframe.locator(selector).evaluate((node) => {
        const r = node.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
      const live = await publicPage.locator(selector).evaluate((node) => {
        const r = node.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
      expect(local.width).toBeCloseTo(live.width, 0);
      expect(local.height).toBeCloseTo(live.height, 0);
    }
    const expectedPosition = width <= 520 ? "50% 80%" : "20% 50%";
    await expect(publicPage.locator(".sf-hero .sf-section-photo")).toHaveCSS(
      "object-position",
      expectedPosition,
    );
    await page.getByRole("button", { name: "Published versions", exact: true }).click();
    const history = await (
      await page.request.get("/api/admin/site/pages/home?history=1")
    ).json();
    const previous = history.revisions.find(
      (r: { version: number }) => r.version < history.revisions[0].version,
    );
    expect(previous).toBeTruthy();
    await page
      .getByRole("button", { name: new RegExp(`^Load version ${previous.version} ·`) })
      .click();
    await expect(page.getByRole("status")).toContainText("loaded for review");
    await publicPage.reload();
    await expect(publicPage.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("button", { name: /^Reload saved version/ }).click();
    await expect(page.getByRole("status")).toContainText("Saved version loaded.");
    expect(
      await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await publicPage.screenshot({
      path: testInfo.outputPath("published-storefront.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: testInfo.outputPath("website-builder.png"),
      fullPage: true,
    });
    // Authorization is checked independently of whether a user can find the UI.
    const customerRole = await db.role.upsert({
      where: { code: "CUSTOMER" },
      update: {},
      create: { code: "CUSTOMER", name: "Customer" },
    });
    const customerEmail = `website-customer-${marker}@example.test`;
    await db.user.create({
      data: {
        email: customerEmail,
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId: customerRole.id } },
        customer: { create: { firstName: "Synthetic" } },
      },
    });
    await publicPage.goto("/sign-in");
    await publicPage.getByLabel("Email", { exact: true }).fill(customerEmail);
    await publicPage.getByLabel("Password", { exact: true }).fill(password);
    await publicPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(publicPage).toHaveURL(/\/account$/);
    expect((await publicPage.request.get("/api/admin/site/pages/home")).status()).toBe(
      403,
    );
    expect(
      (
        await publicPage.request.post("/api/admin/site/media", {
          headers,
          multipart: {
            file: { name: "fixture.png", mimeType: "image/png", buffer: bytes },
          },
        })
      ).status(),
    ).toBe(403);
    await testInfo.attach("storefront-builder-acceptance", {
      body: JSON.stringify({
        viewport: { width, height },
        durablePhoto: true,
        privateDraftPhoto: 404,
        crossOriginWrite: 403,
        customerBuilderRead: 403,
        failedSaveRetained: true,
        previewGeometryMatches: true,
      }),
      contentType: "application/json",
    });
  } finally {
    if (original) {
      const latest = await (await page.request.get("/api/admin/site/pages/home")).json();
      await page.request.put("/api/admin/site/pages/home", {
        headers,
        data: {
          document: {
            sections: original.page.sections,
            settings: original.page.settings,
          },
          version: latest.page.version,
          mode: "publish",
          requestKey: randomUUID(),
        },
      });
    }
    await visitor.close();
    // Fixtures must not leave a staff account behind for the next project's
    // first-administrator acceptance. Restrict cleanup to this test's exact users.
    const fixtureUsers = {
      email: {
        in: [`website-${marker}@example.test`, `website-customer-${marker}@example.test`],
      },
    };
    await db.userRole.deleteMany({ where: { user: fixtureUsers } });
    await db.user.updateMany({ where: fixtureUsers, data: { deletedAt: new Date() } });
    await db.$disconnect();
  }
});
