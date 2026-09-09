import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { test, expect, type Page } from "@playwright/test";
import { operationsFixture, operationsPassword } from "../tests/operations-fixture";
test.use({ actionTimeout: 15000, navigationTimeout: 20000 });
test("delivery command center, customer directory and private completion", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000);
  const db = new PrismaClient();
  const f = await operationsFixture(db);
  const customerContext = await browser.newContext({ viewport: page.viewportSize()! });
  const customerPage = await customerContext.newPage();
  async function login(p: Page, email: string) {
    await p.goto("/sign-in");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(operationsPassword);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  try {
    await login(page, f.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Your day, delivered." }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("01-admin-overview.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: /New customers.*Signed up/ }).click();
    await expect(page).toHaveURL(/group=new/);
    await expect(
      page.getByRole("heading", { name: "New customers · month to date" }),
    ).toBeVisible();
    await page.goto("/admin/customers?sort=name");
    await expect(
      page.getByRole("heading", { name: "Your neighborhood, connected." }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("02-customers-map-directory.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: /Referred customer count/ }).click();
    await expect(
      page.getByRole("heading", { name: "Referred customers", exact: true }),
    ).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Sarah Mitchell");
    await page.getByLabel("Search customers").fill(f.marker);
    await page.getByLabel("Sort customers").selectOption("revenue");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    const exportEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export this page" }).click();
    expect((await exportEvent).suggestedFilename()).toBe("customers-page-1.csv");
    await page.goto("/admin/customers?q=" + f.marker);
    await page.getByRole("button", { name: "Edit Sarah Mitchell", exact: true }).click();
    await page.getByLabel("Phone", { exact: true }).fill("+15555550199");
    await page.getByRole("button", { name: "Save customer", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Customer details saved");
    await page.reload();
    expect(
      (
        await db.customer.findUniqueOrThrow({
          where: { id: f.customers[0].customer!.id },
        })
      ).phone,
    ).toBe("+15555550199");
    await page.getByRole("link", { name: "Add customer", exact: true }).click();
    await page.getByLabel("Customer’s first name").fill("Invited");
    await page.getByLabel("Customer’s email").fill(`invited-${f.marker}@example.test`);
    await page.getByRole("button", { name: "Create invitation link" }).click();
    await expect(page.getByRole("status")).toContainText("No email has been sent");
    expect(
      await db.customerInvite.count({
        where: { email: `invited-${f.marker}@example.test` },
      }),
    ).toBe(1);
    await login(customerPage, f.customers[0].email);
    await expect(customerPage).toHaveURL(/\/account$/);
    expect(
      (await customerPage.request.get("/api/admin/operations/customers")).status(),
    ).toBe(403);
    expect(
      (
        await customerPage.request.post("/api/admin/operations/queue", {
          headers: { origin: "http://localhost:3000" },
          data: { action: "begin", routeId: f.route.id, requestKey: randomUUID() },
        })
      ).status(),
    ).toBe(403);
    await page.goto("/admin/deliveries");
    await expect(
      page.getByRole("heading", { name: "Daily delivery dashboard" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("03-daily-delivery-dashboard.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Start deliveries", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Deliveries started");
    await customerPage.reload();
    await expect(customerPage.getByTestId("delivery-widget")).toContainText(
      "Your items will be delivered today",
    );
    const first = page.getByTestId("stop-" + f.route.stops[0].id);
    const second = page.getByTestId("stop-" + f.route.stops[1].id);
    await expect(
      second.getByRole("button", { name: "Start delivery", exact: true }),
    ).toBeDisabled();
    await first.getByRole("button", { name: "Start delivery", exact: true }).click();
    await expect(first).toContainText("Driver en route");
    await expect(first.getByRole("link", { name: /Open Waze/ })).toHaveAttribute(
      "href",
      /https:\/\/waze.com\/ul\?ll=42.165%2C-88.294&navigate=yes/,
    );
    await page.reload();
    await expect(page.getByTestId("stop-" + f.route.stops[0].id)).toContainText(
      "Driver en route",
    );
    await customerPage.reload();
    await expect(customerPage.getByTestId("delivery-widget")).toContainText(
      "Driver en route",
    );
    await first.getByRole("button", { name: "I’ve arrived" }).click();
    await expect(first).toContainText("Arrived");
    await first.getByRole("button", { name: "Take picture" }).click();
    await page
      .getByLabel("Delivery proof photo")
      .setInputFiles({
        name: "bad.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("synthetic invalid photo"),
      });
    await page.getByRole("button", { name: "Save photo & complete delivery" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "JPEG or PNG",
    );
    expect(
      (await db.routeStop.findUniqueOrThrow({ where: { id: f.route.stops[0].id } }))
        .completedAt,
    ).toBeNull();
    const photo = await sharp({
      create: { width: 400, height: 240, channels: 3, background: "#387c60" },
    })
      .png()
      .toBuffer();
    await page
      .getByLabel("Delivery proof photo")
      .setInputFiles({
        name: "synthetic-proof.png",
        mimeType: "image/png",
        buffer: photo,
      });
    await page.getByRole("button", { name: "Save photo & complete delivery" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(first).toContainText("Completed");
    await expect(
      second.getByRole("button", { name: "Start delivery", exact: true }),
    ).toBeEnabled();
    await customerPage.reload();
    await expect(customerPage.getByTestId("delivery-widget")).toContainText(
      "Delivery completed",
    );
    const photoLink = customerPage.getByRole("link", {
      name: "View delivery photo",
      exact: true,
    });
    await expect(photoLink).toBeVisible();
    expect(
      (await customerPage.request.get((await photoLink.getAttribute("href"))!)).status(),
    ).toBe(200);
    const friendContext = await browser.newContext();
    const friend = await friendContext.newPage();
    await login(friend, f.customers[1].email);
    expect(
      (await friend.request.get((await photoLink.getAttribute("href"))!)).status(),
    ).toBe(404);
    await friendContext.close();
    await page
      .getByRole("link", { name: /Completed deliveries.*stops remaining/ })
      .click();
    await expect(page.getByLabel("Delivery status filter")).toHaveValue("completed");
    await expect(page.locator(".ops-stop")).toHaveCount(1);
    await page.goto("/admin");
    await page.getByRole("link", { name: /Daily delivery revenue.*Orders on/ }).click();
    await expect(
      page.getByRole("heading", { name: "Daily delivery revenue", exact: true }),
    ).toBeVisible();
    await expect(page.locator("tbody")).toContainText(f.orders[0].number);
    await page.getByLabel("Search revenue orders").fill(f.orders[0].number);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: f.orders[0].id } })).totalCents,
    ).toBe(f.orders[0].totalCents);
    await page.goto("/admin/customers");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await info.attach("operations-assertions", {
      body: JSON.stringify({
        realStripe: false,
        photoAdapter: "isolated local development",
        syntheticCustomers: true,
        permissions: true,
        sharedZipIsolation: true,
        customerEditPersistence: true,
        inviteCreatedEmailNotSent: true,
        sequenceEnforced: true,
        refreshDuringRoute: true,
        failedPhotoNotCompleted: true,
        privatePhotoOwnership: true,
        financialAmountsUnchanged: true,
        waze: "verified destination URL only, not an ETA integration",
      }),
      contentType: "application/json",
    });
  } finally {
    await f.cleanup();
    await customerContext.close();
    await db.$disconnect();
  }
});
