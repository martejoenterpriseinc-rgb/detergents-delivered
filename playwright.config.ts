import { defineConfig, devices } from "@playwright/test";
import "./tests/integration-guard";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on",
    screenshot: "on",
    serviceWorkers: "block",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
      testMatch:
        /(contact-entry|payment-overview|delivery-tips|manual-payment-approvals|route-mileage|cpa-ledger|customer-receipt|customer-access|website-builder|environment-settings|operating-media|finance|catalog-files|commerce-connections|quickbooks-connection|quickbooks-costs|delivery-sms|delivery-text-monitor|order-workspace|order-returns|reward-refunds|subscriptions|launch-offers)\.spec\.ts/,
    },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "npm start",
    url: "http://localhost:3000/api/ready",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
