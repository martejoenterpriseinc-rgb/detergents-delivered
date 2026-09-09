import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import { businessFixture, businessPassword } from "../tests/business-fixture";
import { emptyProfile, BUSINESS_ID, type SetupData } from "../lib/business/domain";
test("business wizard saves choices, recovers failed saves and protects private documents", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000);
  const db = new PrismaClient();
  const f = await businessFixture(db);
  const visitor = await browser.newContext();
  try {
    expect((await visitor.request.get("/api/admin/business")).status()).toBe(401);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(f.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(businessPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const response = await page.request.post("/api/admin/business", {
      headers: { origin: "http://localhost:3000" },
      data: {
        version: 0,
        command: {
          action: "profile",
          profile: {
            ...emptyProfile,
            tradeName: "Synthetic Detergents",
            legalOwner: "Synthetic Owner",
            address: "123 Synthetic Lane",
            stateConfirmed: true,
            county: "McHenry",
            municipality: "Lake in the Hills",
            premises: "HOME",
            employees: "NO",
            products: "SEALED",
            transfers: "NO",
            existingConfirmed: true,
            assumedName: "NO",
          },
        },
      },
    });
    expect(response.status()).toBe(200);
    await page.goto("/admin/settings/business/setup");
    await expect(
      page.getByRole("heading", { name: "Choose the structure that fits your business" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Sole proprietor", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "McHenry County assumed business name",
    );
    await page.screenshot({
      path: info.outputPath("business-structure-choices.png"),
      fullPage: true,
    });
    await page
      .getByRole("tabpanel")
      .screenshot({ path: info.outputPath("sole-proprietor-preview.png") });
    await page.getByRole("tab", { name: "Single-member LLC", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("Form the Illinois LLC");
    expect(
      (
        (await db.businessSetup.findUniqueOrThrow({ where: { id: BUSINESS_ID } }))
          .dataJson as unknown as SetupData
      ).activePlanId,
    ).toBeNull();
    await page
      .getByRole("tabpanel")
      .screenshot({ path: info.outputPath("single-member-llc-preview.png") });
    let releaseProfile!: () => void;
    let profileStarted!: () => void;
    const profileHeld = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });
    const profileRequested = new Promise<void>((resolve) => {
      profileStarted = resolve;
    });
    await page.route("**/api/admin/business", async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postDataJSON()?.command?.action === "profile"
      ) {
        profileStarted();
        await profileHeld;
      }
      await route.continue();
    });
    try {
      await page
        .getByLabel("Actual legal owner or approved LLC legal name")
        .fill("Synthetic Owner LLC");
      // Hold the actual autosave so the race is deterministic on every device.
      await profileRequested;
      // Deliberately choose while the real profile write is still pending.
      // The choice must wait for that save rather than silently discard the click.
      await page.getByRole("button", { name: "Choose LLC", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Choose LLC", exact: true }),
      ).toBeDisabled();
    } finally {
      releaseProfile();
    }
    await expect(
      page.getByRole("heading", { name: "Form the Illinois LLC", exact: true }),
    ).toBeVisible();
    await page.unroute("**/api/admin/business");
    await expect(
      page.getByRole("navigation", { name: "Business setup checklist" }),
    ).not.toContainText("assumed business name");
    await page.route("**/api/admin/business", async (route) => {
      if (route.request().method() === "POST")
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Synthetic save interruption — retry your retained edit.",
          }),
        });
      return route.continue();
    });
    await page
      .getByLabel("Notes / authority response")
      .fill("Synthetic saved notes after retry.");
    await expect(
      page.getByText("Synthetic save interruption — retry your retained edit.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.unroute("**/api/admin/business");
    await page.getByRole("button", { name: "Retry save" }).click();
    await expect
      .poll(async () => {
        const row = await db.businessSetup.findUniqueOrThrow({
          where: { id: BUSINESS_ID },
        });
        const data = row.dataJson as unknown as SetupData;
        return data.plans.find((p) => p.id === data.activePlanId)?.tasks.formation.notes;
      })
      .toBe("Synthetic saved notes after retry.");
    await page.reload();
    await expect(page.getByLabel("Notes / authority response")).toHaveValue(
      "Synthetic saved notes after retry.",
    );
    // Navigate immediately, before the 900 ms autosave timer can fire.
    await page.getByLabel("Notes / authority response").fill("Synthetic sidebar save.");
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/settings/business/setup");
    await expect(page.getByLabel("Notes / authority response")).toHaveValue(
      "Synthetic sidebar save.",
    );
    const second = await page.context().newPage();
    await second.goto("/admin/settings/business/setup");
    await page
      .getByLabel("Notes / authority response")
      .fill("Synthetic concurrent winner persists.");
    await page.getByRole("button", { name: "Save and Continue" }).click();
    await expect(
      page.getByRole("heading", { name: "Prepare an operating agreement", exact: true }),
    ).toBeVisible();
    await second
      .getByLabel("Notes / authority response")
      .fill("Synthetic stale session must not overwrite.");
    await expect(
      second.getByText(
        "Business setup changed in another session. Reload the saved version before applying these edits.",
        { exact: true },
      ),
    ).toBeVisible();
    await second.close();
    await page.getByRole("button", { name: /1\. Form the Illinois LLC/ }).click();
    await expect(page.getByLabel("Notes / authority response")).toHaveValue(
      "Synthetic concurrent winner persists.",
    );
    await page.screenshot({
      path: info.outputPath("selected-business-wizard.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page
      .getByRole("link", { name: "Business Documents", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("heading", { name: "Business Documents", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Document title", { exact: true })
      .fill("Synthetic quarantined business document");
    await page.getByLabel("Choose a document").setInputFiles({
      name: "synthetic-evidence.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF",
      ),
    });
    await page.getByRole("button", { name: "Save document", exact: true }).click();
    await expect(
      page.getByText("Saved encrypted. Quarantined until security scanning completes.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Synthetic quarantined business document",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview / download" })).toHaveCount(0);
    const version = await db.businessDocumentVersion.findFirstOrThrow();
    expect(
      (
        await page.request.get(`/api/admin/business/documents/${version.id}?token=forged`)
      ).status(),
    ).toBe(403);
    await page.screenshot({
      path: info.outputPath("private-business-documents.png"),
      fullPage: true,
    });
    const customer = await visitor.newPage();
    await customer.goto("/sign-in");
    await customer.getByLabel("Email", { exact: true }).fill(f.customer.email);
    await customer.getByLabel("Password", { exact: true }).fill(businessPassword);
    await customer.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(customer).toHaveURL(/\/account$/);
    expect((await visitor.request.get("/api/admin/business/documents")).status()).toBe(
      403,
    );
  } finally {
    await visitor.close();
    await f.cleanup();
    await db.$disconnect();
  }
});
