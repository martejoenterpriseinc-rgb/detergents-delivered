import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import { businessFixture, businessPassword } from "../tests/business-fixture";

test("admin drawer groups workspaces and KPI links open matching lists", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const db = new PrismaClient();
  const f = await businessFixture(db);
  try {
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(f.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(businessPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("progressbar", { name: "Business setup completeness" }),
    ).toBeVisible();
    const drawer = page.getByRole("navigation", { name: "Admin navigation" });
    await expect(drawer.getByRole("link")).toHaveText([
      "Dashboard",
      "Orders",
      "Deliveries",
      "Customers",
      "Inventory",
      "Receiving",
      "Website",
      "Payments",
      "Reports",
      "Settings",
    ]);
    await drawer.getByRole("link", { name: "Customers", exact: true }).click();
    const tools = page.getByRole("navigation", { name: "Workspace tools" });
    await expect(
      tools.getByRole("link", { name: "Customer support", exact: true }),
    ).toBeVisible();
    await expect(
      tools.getByRole("link", { name: "Loyalty program", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Support tickets.*Open the active support queue/ }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("customers-workspace.png"),
      fullPage: true,
    });
    await drawer.getByRole("link", { name: "Inventory", exact: true }).click();
    await expect(
      tools.getByRole("link", { name: "+ Category", exact: true }),
    ).toBeVisible();
    await expect(tools.getByRole("link", { name: "+ Item", exact: true })).toBeVisible();
    await page.getByRole("link", { name: /Low-stock items/ }).click();
    await expect(page.locator("caption")).toContainText("Low-stock inventory");
    await page.screenshot({
      path: info.outputPath("inventory-workspace.png"),
      fullPage: true,
    });
    await drawer.getByRole("link", { name: "Receiving", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Received batches", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "All purchase orders", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("receiving-workspace.png"),
      fullPage: true,
    });
    await tools.getByRole("link", { name: "+ Purchase order", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Vendor", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh vendor list" })).toBeVisible();
    await drawer.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(tools.getByRole("link")).toHaveText([
      "Reports",
      "CPA center",
      "Import / export",
      "Expenses",
      "Mileage",
      "Taxes",
    ]);
    await drawer.getByRole("link", { name: "Settings", exact: true }).click();
    await tools.getByRole("link", { name: "Address approvals", exact: true }).click();
    await expect(drawer.getByRole("link", { name: "Settings", exact: true })).toHaveClass(
      "selected",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await f.cleanup();
    await db.$disconnect();
  }
});
