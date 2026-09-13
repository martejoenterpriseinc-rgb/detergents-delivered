import { describe, expect, it } from "vitest";
import { reviewReleaseMigrations } from "./release-migration-review";

const migrations = [1, 2, 3].map((n) => ({
  name: `2026091300000${n}_example`,
  checksum: String(n).repeat(64),
}));
const manifest = {
  baselineCommit: "a".repeat(40),
  candidateCommit: "b".repeat(40),
  baselineMigrationCount: 1,
  migrations,
};
const inspection = {
  status: "pending",
  tableCount: 10,
  completedMigrations: 1,
  pendingMigrations: migrations.slice(1).map((m) => m.name),
  problems: [],
};
describe("release migration review", () => {
  it("returns exact pending checksums without granting migration execution", () => {
    expect(reviewReleaseMigrations(manifest, migrations, inspection)).toMatchObject({
      status: "pending",
      pendingMigrations: migrations.slice(1),
      migrationExecuted: false,
    });
  });
  it("accepts a partially applied ordered release and a current schema", () => {
    expect(
      reviewReleaseMigrations(manifest, migrations, {
        ...inspection,
        completedMigrations: 2,
        pendingMigrations: [migrations[2].name],
      }).pendingMigrations,
    ).toEqual([migrations[2]]);
    expect(
      reviewReleaseMigrations(manifest, migrations, {
        ...inspection,
        status: "current",
        completedMigrations: 3,
        pendingMigrations: [],
      }).status,
    ).toBe("current");
  });
  it.each([
    { ...inspection, status: "blocked" },
    { ...inspection, status: "current" },
    { ...inspection, problems: ["checksum differs"] },
    { ...inspection, completedMigrations: 0 },
    { ...inspection, completedMigrations: 4 },
    { ...inspection, pendingMigrations: [migrations[2].name, migrations[1].name] },
    { ...inspection, pendingMigrations: [] },
  ])("rejects incomplete or inconsistent database evidence %#", (value) => {
    expect(() => reviewReleaseMigrations(manifest, migrations, value)).toThrow();
  });
  it("rejects changed retained SQL, extra migrations and duplicate manifests", () => {
    expect(() =>
      reviewReleaseMigrations(
        manifest,
        [{ ...migrations[0], checksum: "d".repeat(64) }, ...migrations.slice(1)],
        inspection,
      ),
    ).toThrow();
    expect(() =>
      reviewReleaseMigrations(manifest, migrations.slice(0, 2), inspection),
    ).toThrow();
    expect(() =>
      reviewReleaseMigrations(
        { ...manifest, migrations: [...migrations, migrations[2]] },
        migrations,
        inspection,
      ),
    ).toThrow();
  });
});
