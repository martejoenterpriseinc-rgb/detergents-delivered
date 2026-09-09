import { expect, it } from "vitest";
import { productionProvisioningAction } from "./production-provisioning";
it("initializes only pristine storage and sends existing production to read-only checks", () => {
  expect(productionProvisioningAction([], false)).toBe("initialize");
  expect(productionProvisioningAction(["Setting", "Order"], true)).toBe("preflight");
  for (const tables of [
    ["_prisma_migrations"],
    ["Setting"],
    ["Order"],
    ["_prisma_migrations", "Setting"],
  ])
    expect(() => productionProvisioningAction(tables, false)).toThrow(/empty database/);
});
