import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "../tests/integration-guard";

test.use({ actionTimeout: 15000, navigationTimeout: 20000 });

test("customer account, order support, staff KPIs, failed saves, and password revocation", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const db = new PrismaClient({ log: [] });
  const marker = randomUUID();
  const password = "Synthetic-Account-Password-123";
  const context = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const adminPage = await context.newPage();
  const otherContext = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 390, height: 844 },
  });
  const otherPage = await otherContext.newPage();
  async function login(target: Page, email: string, secret: string) {
    await target.goto("/sign-in");
    await target.getByLabel("Email", { exact: true }).fill(email);
    await target.getByLabel("Password", { exact: true }).fill(secret);
    await target.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const headers = { origin: "http://localhost:3000" };
  try {
    const role = await db.role.upsert({
      where: { code: "ADMIN" },
      update: {},
      create: { code: "ADMIN", name: "Admin" },
    });
    const admin = await db.user.create({
      data: {
        email: `staff-${marker}@example.test`,
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId: role.id } },
      },
    });
    const users = [];
    for (const suffix of ["a", "b"])
      users.push(
        await db.user.create({
          data: {
            email: `${suffix}-${marker}@example.test`,
            passwordHash: await bcrypt.hash(password, 4),
            customer: {
              create: {
                firstName: "Synthetic",
                addresses: {
                  create: {
                    line1: `1${suffix} Synthetic Way`,
                    city: "Algonquin",
                    region: "IL",
                    postalCode: "60102",
                  },
                },
              },
            },
          },
          include: { customer: true },
        }),
      );
    const [a, b] = users;
    const order = await db.order.create({
      data: {
        number: `DD-TEST-${marker}`,
        customerId: a.customer!.id,
        status: "OUT_FOR_DELIVERY",
        totalCents: 4384,
      },
    });
    expect(
      (
        await page.request.patch("/api/account", {
          headers,
          data: { firstName: "Intruder", lastName: "", phone: "" },
        })
      ).status(),
    ).toBe(401);
    await login(page, a.email, password);
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText("Loyalty Club", { exact: true })).toBeVisible();
    await expect(page.getByText("Account created:", { exact: false })).toBeVisible();
    await expect(page.getByText(order.number)).toBeVisible();
    await expect(page.getByText("DD-DEMO", { exact: false })).toHaveCount(0);
    await page.getByRole("link", { name: "Edit customer info" }).click();
    await page.getByLabel("First name", { exact: true }).fill("Updated synthetic");
    await page.getByLabel("Phone number").fill("+15555550199");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Changes saved.");
    await page.reload();
    await expect(page.getByLabel("First name", { exact: true })).toHaveValue(
      "Updated synthetic",
    );
    expect(
      (await db.customer.findUnique({ where: { id: a.customer!.id } }))?.firstName,
    ).toBe("Updated synthetic");
    await page.route("**/api/account", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected save failure" }),
      }),
    );
    await page.getByLabel("First name", { exact: true }).fill("Must not persist");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Injected save failure" }),
    ).toHaveText("Injected save failure");
    expect(
      (await db.customer.findUnique({ where: { id: a.customer!.id } }))?.firstName,
    ).toBe("Updated synthetic");
    await page.unroute("**/api/account");
    await page.goto("/account/settings/notifications");
    await page.getByLabel("Email delivery notifications").check();
    await page.getByLabel("SMS delivery notifications").check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Changes saved.");
    await page.reload();
    await expect(page.getByLabel("Email delivery notifications")).toBeChecked();
    expect(
      (await db.customer.findUnique({ where: { id: a.customer!.id } }))?.smsNotifications,
    ).toBe(true);
    await page.goto("/account");
    await page.screenshot({
      path: testInfo.outputPath("customer-account.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: "Report a problem", exact: true }).click();
    await page.getByLabel("Subject", { exact: true }).fill(`Missing item ${marker}`);
    await page
      .getByLabel("What happened?")
      .fill("One synthetic item is missing from this order.");
    await page.getByRole("button", { name: "Submit ticket" }).click();
    await expect(page).not.toHaveURL(/\/support\/new/);
    await expect(page).toHaveURL(/\/account\/support\/[^/]+$/);
    const ticket = await db.supportTicket.findFirstOrThrow({
      where: { orderId: order.id },
    });
    await expect(
      page.getByRole("heading", { name: `Missing item ${marker}` }),
    ).toBeVisible();
    await login(otherPage, b.email, password);
    await expect(otherPage).toHaveURL(/\/account$/);
    await expect(otherPage.getByText(order.number)).toHaveCount(0);
    expect((await otherPage.request.get(`/api/support/${ticket.id}`)).status()).toBe(404);
    expect((await otherPage.request.get("/api/support?scope=admin")).status()).toBe(403);
    expect(
      (
        await otherPage.request.post("/api/support", {
          headers,
          data: {
            orderId: order.id,
            subject: "Unauthorized problem",
            category: "Delivery",
            message: "Invalid owned order.",
            requestKey: randomUUID(),
          },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.patch("/api/account", {
          headers: { origin: "https://attacker.example" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await login(adminPage, admin.email, password);
    await expect(adminPage).toHaveURL(/\/account$/);
    await adminPage.goto("/admin");
    await adminPage
      .getByRole("link", { name: /Support tickets.*Active tickets/ })
      .click();
    await expect(adminPage).toHaveURL(/\/admin\/support\?status=ACTIVE/);
    await adminPage.getByLabel("Lookup", { exact: true }).fill(marker);
    await adminPage.getByRole("button", { name: "Apply filters" }).click();
    await adminPage
      .getByRole("link", { name: new RegExp(`Missing item ${marker}`) })
      .click();
    await adminPage
      .getByLabel("Reply to customer")
      .fill("We have reviewed your synthetic order and resolved the issue.");
    await adminPage.getByLabel("Ticket status").selectOption("RESOLVED");
    await adminPage.getByRole("button", { name: "Save reply and status" }).click();
    await expect(
      adminPage.getByText(
        "We have reviewed your synthetic order and resolved the issue.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("We have reviewed your synthetic order and resolved the issue.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Your reply").fill("I still need help with this delivery.");
    await page.getByRole("button", { name: "Send reply", exact: true }).click();
    await expect(
      page.getByText("I still need help with this delivery.", { exact: true }),
    ).toBeVisible();
    expect(
      (await db.supportTicket.findUnique({ where: { id: ticket.id } }))?.status,
    ).toBe("OPEN");
    await adminPage.goto(`/admin/support?status=OPEN&q=${marker}`);
    await adminPage.screenshot({
      path: testInfo.outputPath("support-dashboard.png"),
      fullPage: true,
    });
    expect(
      await adminPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const filters = [
      adminPage.getByLabel("Lookup", { exact: true }),
      adminPage.getByLabel("Status", { exact: true }),
      adminPage.getByLabel("Sort", { exact: true }),
      adminPage.getByRole("button", { name: "Apply filters" }),
    ];
    const boxes = await Promise.all(filters.map((field) => field.boundingBox()));
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i]).not.toBeNull();
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlaps, "Support filters must not overlap").toBe(false);
      }
    }
    const exported = await adminPage.request.get(
      `/api/admin/support/export?status=OPEN&q=${marker}`,
    );
    expect(exported.status()).toBe(200);
    expect(await exported.text()).toContain(ticket.id);
    const secondLogin = await browser.newContext();
    try {
      const secondPage = await secondLogin.newPage();
      await login(secondPage, a.email, password);
      await expect(secondPage).toHaveURL(/\/account$/);
      await page.goto("/account/settings/security");
      await page.getByLabel("Current password", { exact: true }).fill(password);
      await page
        .getByLabel("New password", { exact: true })
        .fill("New-Synthetic-Password-456");
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill("New-Synthetic-Password-456");
      await page.getByRole("button", { name: "Change password", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Password changed");
      expect((await secondPage.request.get("/api/account")).status()).toBe(401);
      expect((await page.request.get("/api/account")).status()).toBe(401);
      await login(page, a.email, password);
      await expect(page).toHaveURL(/error=credentials/);
      await login(page, a.email, "New-Synthetic-Password-456");
      await expect(page).toHaveURL(/\/account$/);
    } finally {
      await secondLogin.close();
    }
    expect(await db.order.findUnique({ where: { id: order.id } })).toEqual(order);
    await testInfo.attach("account-support-database-assertions", {
      body: JSON.stringify({
        customerProfilePersisted: true,
        notificationPreferencesPersisted: true,
        foreignCustomerTicketRead: 404,
        customerAdminRead: 403,
        crossOriginWrite: 403,
        passwordSessionsRevoked: true,
        orderMoneyUnchanged: true,
        supportTicketId: ticket.id,
        injectedFailure: "HTTP 503 only; provider calls are not tested",
      }),
      contentType: "application/json",
    });
  } finally {
    await context.close();
    await otherContext.close();
    await db.$disconnect();
  }
});
