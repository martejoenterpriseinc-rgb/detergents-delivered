import { test, expect } from "@playwright/test";
test("homepage support entry preserves ticket destination through sign-in and registration", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Contact us", exact: true }).first().click();
  await expect(page).toHaveURL(/\/contact$/);
  await page.getByRole("link", { name: "Create an account to contact support" }).click();
  await expect(page).toHaveURL(/\/register\?callbackUrl=%2Faccount%2Fsupport%2Fnew/);
  await expect(page.locator('form input[name="callbackUrl"]').first()).toHaveValue(
    "/account/support/new",
  );
  await page.getByRole("link", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Faccount%2Fsupport%2Fnew/);
  await expect(page.locator('form input[name="callbackUrl"]').first()).toHaveValue(
    "/account/support/new",
  );
  await page.getByRole("link", { name: "Create an account", exact: true }).click();
  await expect(page.locator('form input[name="callbackUrl"]').first()).toHaveValue(
    "/account/support/new",
  );
  await page.goto("/register?callbackUrl=https%3A%2F%2Fexample.com");
  await expect(page.locator('form input[name="callbackUrl"]').first()).toHaveValue(
    "/account/entry",
  );
});
