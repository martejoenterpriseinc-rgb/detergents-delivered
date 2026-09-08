import { describe, expect, it } from "vitest";
import { assessDatabaseHistory, type AppliedMigration } from "./database-history";
const local = [
  { name: "001", checksum: "first" },
  { name: "002", checksum: "second" },
];
const row = (name = "001", checksum = "first"): AppliedMigration => ({
  migration_name: name,
  checksum,
  finished_at: new Date(),
  rolled_back_at: null,
});
describe("read-only migration review", () => {
  it("distinguishes empty, pending and current without granting migration permission", () => {
    expect(assessDatabaseHistory([], [], local).status).toBe("empty");
    expect(
      assessDatabaseHistory(["_prisma_migrations", "User"], [row()], local).status,
    ).toBe("pending");
    expect(
      assessDatabaseHistory(
        ["_prisma_migrations", "User"],
        [row(), row("002", "second")],
        local,
      ).status,
    ).toBe("current");
  });
  it.each([
    [["User"], []],
    [["_prisma_migrations", "User"], []],
    [["_prisma_migrations"], [row("001", "tampered")]],
    [["_prisma_migrations"], [row("foreign-history")]],
    [["_prisma_migrations"], [{ ...row(), finished_at: null }]],
    [["_prisma_migrations"], [row("002", "second")]],
    [["_prisma_migrations"], [row(), row()]],
  ] as Array<[string[], AppliedMigration[]]>)(
    "blocks unsafe history %#",
    (tables, applied) => {
      expect(assessDatabaseHistory(tables, applied, local).status).toBe("blocked");
    },
  );
  it("recognizes a recorded rollback followed by a matching retry", () => {
    expect(
      assessDatabaseHistory(
        ["_prisma_migrations"],
        [{ ...row(), finished_at: null, rolled_back_at: new Date() }, row()],
        local,
      ).status,
    ).toBe("pending");
  });
});
