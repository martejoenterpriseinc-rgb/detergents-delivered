import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), count: vi.fn(), seed: vi.fn() }));
vi.mock("@/lib/demo-mode", () => ({
  canSeedDemoCatalog: () => false,
  shouldSeedDemoCatalogOnBoot: () => false,
}));
vi.mock("@/lib/services/delivery-settings", () => ({
  ensureDeliverySettingsSeeded: mocks.settings,
}));
vi.mock("../prisma/demo-catalog", () => ({
  countVisibleShopProducts: mocks.count,
  seedDemoCatalog: mocks.seed,
}));
import { ensureDemoCatalogOnBoot } from "./demo-boot";

it("does no catalog/settings work when demo seeding is disabled (mocked services)", async () => {
  expect(await ensureDemoCatalogOnBoot()).toEqual({ seeded: false, reason: "disabled" });
  expect(mocks.settings).not.toHaveBeenCalled();
  expect(mocks.count).not.toHaveBeenCalled();
  expect(mocks.seed).not.toHaveBeenCalled();
});
