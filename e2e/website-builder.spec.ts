import { randomUUID } from "node:crypto";
import { test, expect, type Locator } from "@playwright/test";
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
    const editorAlert = page.locator(".wb-root").getByRole("alert");
    await expect(editorAlert).toContainText("unsaved changes");
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
    let imageId = saved.draft.sections.find(
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
    // Failed replacement retains the prior draft photo and the file for a retry.
    const replacement = await sharp({
      create: {
        width: 81,
        height: 61,
        channels: 3,
        background: {
          r: parseInt(marker.slice(0, 2), 16),
          g: parseInt(marker.slice(2, 4), 16),
          b: parseInt(marker.slice(4, 6), 16),
        },
      },
    })
      .png()
      .toBuffer();
    const beforePhotos = await db.siteMedia.count();
    await page.route("**/api/admin/site/media", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected upload failure" }),
      }),
    );
    await page.getByLabel("Upload photo", { exact: true }).setInputFiles({
      name: "replacement-photo.png",
      mimeType: "image/png",
      buffer: replacement,
    });
    await expect(editorAlert).toHaveText("Injected upload failure");
    await expect(page.getByAltText("Current selected photo")).toHaveAttribute(
      "src",
      `/api/site/media/${imageId}`,
    );
    await expect(
      page.getByRole("button", { name: "Save & apply", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeDisabled();
    expect(await db.siteMedia.count()).toBe(beforePhotos);
    // Changing areas and preview sizes must not redirect the saved file to another area.
    await page.getByLabel("Selected area").selectOption("footer");
    await page.getByRole("button", { name: /^mobile$/i }).click();
    await page.unroute("**/api/admin/site/media");
    await page.route("**/api/admin/site/media", async (route) => {
      const accepted = await route.fetch();
      expect(accepted.status()).toBe(201);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Retry upload", exact: true }).click();
    await expect(editorAlert).toBeVisible();
    expect(await db.siteMedia.count()).toBe(beforePhotos + 1);
    await page.unroute("**/api/admin/site/media");
    await page.getByRole("button", { name: "Retry upload", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Photo uploaded" }),
    ).toBeVisible();
    expect(await db.siteMedia.count()).toBe(beforePhotos + 1);
    await page.getByLabel("Selected area").selectOption("hero");
    const uploadedSrc = await page
      .getByAltText("Current selected photo")
      .getAttribute("src");
    expect(uploadedSrc).not.toBe(`/api/site/media/${imageId}`);
    imageId = uploadedSrc!.split("/").at(-1)!;
    expect(
      await db.auditLog.count({
        where: { entityId: imageId, action: "site.media.uploaded" },
      }),
    ).toBe(1);
    expect((await publicPage.request.get(`/api/site/media/${imageId}`)).status()).toBe(
      404,
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Draft saved" }),
    ).toBeVisible();
    await page.reload();
    await page.getByLabel("Selected area").selectOption("hero");
    await expect(page.getByAltText("Current selected photo")).toHaveAttribute(
      "src",
      uploadedSrc!,
    );
    await page.getByLabel("Upload photo", { exact: true }).setInputFiles({
      name: "invalid-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("not an image"),
    });
    await expect(editorAlert).toContainText("Choose a valid JPEG");
    await expect(page.getByAltText("Current selected photo")).toHaveAttribute(
      "src",
      uploadedSrc!,
    );
    await page.getByRole("button", { name: "Discard upload", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save & apply", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: new RegExp(`^${device}$`, "i") }).click();
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
    await expect(editorAlert).toHaveText("Injected save failure");
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
    await expect(iframe.locator(".sf-edit-mode")).toHaveCount(0);
    await iframe
      .locator(".sf-header")
      .getByRole("link", { name: "Sign in", exact: true })
      .click();
    await expect(iframe.getByRole("heading", { name: title })).toBeVisible();
    await expect
      .poll(() => iframe.locator("body").evaluate(() => window.innerWidth))
      .toBe(width);
    for (const selector of [
      ".sf-header",
      ".sf-hero h1",
      ".sf-hero .sf-section-photo",
      ".sf-step-grid",
      ".sf-product-grid",
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
    // Section type classes must never apply the inner grid to the whole section.
    // That nested grid previously squeezed desktop steps into one third of the page.
    for (const selector of [".sf-step-grid", ".sf-product-grid"]) {
      const size = await publicPage.locator(selector).boundingBox();
      expect(size!.width).toBeGreaterThanOrEqual(Math.min(width, 1200) - 70);
    }
    const stepBoxes = await publicPage
      .locator(".sf-step-grid article")
      .evaluateAll((steps) =>
        steps.map((step) => {
          const rect = step.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width };
        }),
      );
    expect(stepBoxes).toHaveLength(3);
    if (width <= 520) {
      expect(stepBoxes.every((step) => step.x === stepBoxes[0].x)).toBe(true);
      expect(stepBoxes[1].y).toBeGreaterThan(stepBoxes[0].y);
      expect(stepBoxes[0].width).toBeGreaterThan(300);
    } else {
      expect(stepBoxes.every((step) => step.y === stepBoxes[0].y)).toBe(true);
      expect(stepBoxes[0].width).toBeGreaterThan(200);
    }
    await publicPage.locator("section.sf-steps").screenshot({
      path: testInfo.outputPath("how-it-works.png"),
    });
    // Keep coverage for the default steps that include supporting descriptions.
    for (const surface of [iframe, publicPage]) {
      const descriptions = surface.locator(".sf-step-grid article p");
      await expect(descriptions).toHaveCount(3);
      expect((await descriptions.allTextContents()).every((text) => text.trim())).toBe(
        true,
      );
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
    // Match the owner's saved title-only copy. A single-column grid alone can
    // still consume the whole phone screen if numbers sit above oversized rows.
    const stepTitles = ["Check your ZIP", "Fill the cart", "We bring it by"];
    await page.getByLabel("Selected area").selectOption("how-it-works");
    await page.getByLabel("Heading", { exact: true }).fill("How it works");
    await page.getByLabel("Eyebrow", { exact: true }).fill("HOW IT WORKS");
    await page
      .getByLabel("Steps (one title | description per line)", { exact: true })
      .fill(stepTitles.join("\n"));
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Draft saved" }),
    ).toBeVisible();
    await page.reload();
    await page.getByLabel("Selected area").selectOption("how-it-works");
    await expect(
      page.getByLabel("Steps (one title | description per line)", { exact: true }),
    ).toHaveValue(stepTitles.join("\n"));
    await page.getByRole("button", { name: new RegExp(`^${device}$`, "i") }).click();
    await expect
      .poll(() => iframe.locator("body").evaluate(() => window.innerWidth))
      .toBe(width);
    await expect(iframe.locator(".sf-step-grid h3")).toHaveText(stepTitles);
    // Saving this draft must not change the published, paragraph-bearing copy.
    await publicPage.reload();
    await expect(publicPage.locator(".sf-step-grid article p")).toHaveCount(3);
    await page.getByRole("button", { name: "Save & apply", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved and applied" }),
    ).toBeVisible();
    await publicPage.reload();
    const assertCompactSteps = async (section: Locator) => {
      await expect(section.getByRole("heading", { level: 3 })).toHaveText(stepTitles);
      await expect(section.locator(".sf-copy").getByText(/^how it works$/i)).toHaveCount(
        1,
      );
      await expect(section.locator(".sf-step-grid article p")).toHaveCount(0);
      const layout = await section.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          overflow: node.scrollWidth > node.clientWidth,
          steps: Array.from(node.querySelectorAll(".sf-step-grid article")).map(
            (article) => {
              const row = article.getBoundingClientRect();
              const number = article.querySelector("span")!.getBoundingClientRect();
              const title = article.querySelector("h3")!;
              const heading = title.getBoundingClientRect();
              return {
                x: row.x,
                y: row.y,
                height: row.height,
                numberRight: number.right,
                numberCenter: number.y + number.height / 2,
                titleX: heading.x,
                titleCenter: heading.y + heading.height / 2,
                titleHeight: heading.height,
                titleLineHeight: parseFloat(getComputedStyle(title).lineHeight),
                titleFits:
                  title.scrollWidth <= title.clientWidth &&
                  title.scrollHeight <= title.clientHeight,
              };
            },
          ),
        };
      });
      expect(layout.overflow).toBe(false);
      expect(layout.steps).toHaveLength(3);
      for (const step of layout.steps) {
        expect(step.titleFits).toBe(true);
        // These short phrases must fit without breaking words or clipping text.
        expect(step.titleHeight).toBeLessThanOrEqual(step.titleLineHeight + 1);
      }
      if (width <= 520) {
        expect(layout.height).toBeLessThanOrEqual(340);
        for (const [index, step] of layout.steps.entries()) {
          expect(step.x).toBeCloseTo(layout.steps[0].x, 0);
          expect(step.height).toBeLessThanOrEqual(64);
          expect(step.titleX).toBeGreaterThan(step.numberRight);
          expect(Math.abs(step.titleCenter - step.numberCenter)).toBeLessThanOrEqual(2);
          if (index) expect(step.y).toBeGreaterThan(layout.steps[index - 1].y);
        }
      } else {
        for (const [index, step] of layout.steps.entries()) {
          expect(step.y).toBeCloseTo(layout.steps[0].y, 0);
          if (index) expect(step.x).toBeGreaterThan(layout.steps[index - 1].x);
        }
      }
      return { width: layout.width, height: layout.height };
    };
    const previewSteps = await assertCompactSteps(iframe.locator("section.sf-steps"));
    const publishedSteps = await assertCompactSteps(
      publicPage.locator("section.sf-steps"),
    );
    expect(previewSteps.width).toBeCloseTo(publishedSteps.width, 0);
    expect(previewSteps.height).toBeCloseTo(publishedSteps.height, 0);
    await publicPage.locator("section.sf-steps").screenshot({
      path: testInfo.outputPath("how-it-works-title-only.png"),
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
        failedUploadRetained: true,
        uploadRetryAfterLostResponse: true,
        previewGeometryMatches: true,
        titleOnlyStepsCompact: true,
        duplicateStepHeadingRemoved: true,
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
