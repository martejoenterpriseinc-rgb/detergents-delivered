import { describe, expect, it } from "vitest";
import { refundMigrationAction } from "./refund-migration-gate";

const inspected = {
  status: "pending",
  tableCount: 70,
  completedMigrations: 30,
  pendingMigrations: [
    "20260915100000_refund_return_lifecycle",
    "20260915101000_return_cost_evidence",
  ],
  problems: [],
};
describe("reviewed refund release migration gate", () => {
  it("allows only reviewed pending migrations and accepts an already-current database", () => {
    expect(refundMigrationAction(inspected)).toBe("migrate");
    expect(
      refundMigrationAction({ ...inspected, status: "current", pendingMigrations: [] }),
    ).toBe("current");
  });
  it("blocks unrelated migrations, uninitialized databases and damaged history", () => {
    for (const value of [
      {
        ...inspected,
        pendingMigrations: [...inspected.pendingMigrations, "unreviewed_change"],
      },
      { ...inspected, status: "empty", tableCount: 0, completedMigrations: 0 },
      {
        ...inspected,
        status: "blocked",
        problems: ["Applied migration checksum differs from retained SQL."],
      },
      { ...inspected, problems: ["Unfinished migration"] },
      { ...inspected, status: "current" },
      {},
    ])
      expect(() => refundMigrationAction(value)).toThrow();
  });
});
