import { z } from "zod";
import type { LocalMigration } from "./database-history";

export const releaseMigrationManifest = z
  .object({
    baselineCommit: z.string().regex(/^[a-f0-9]{40}$/),
    candidateCommit: z.string().regex(/^[a-f0-9]{40}$/),
    baselineMigrationCount: z.number().int().positive(),
    migrations: z
      .array(
        z.object({
          name: z.string().regex(/^\d{14}_[a-z0-9_]+$/),
          checksum: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .nonempty(),
  })
  .strict();

/** Read-only review. A matching plan is not backup evidence or permission to migrate. */
export function reviewReleaseMigrations(
  rawManifest: unknown,
  local: LocalMigration[],
  rawInspection: unknown,
) {
  const manifest = releaseMigrationManifest.parse(rawManifest);
  const inspection = z
    .object({
      status: z.enum(["current", "pending"]),
      tableCount: z.number().int().positive(),
      completedMigrations: z.number().int().positive(),
      pendingMigrations: z.array(z.string()),
      problems: z.array(z.string()).length(0),
    })
    .parse(rawInspection);
  const names = manifest.migrations.map((m) => m.name);
  if (
    new Set(names).size !== names.length ||
    names.some((n, i) => i > 0 && n <= names[i - 1])
  )
    throw new Error("Release migrations must be unique and ordered.");
  if (manifest.baselineMigrationCount >= names.length)
    throw new Error("Release must extend its retained baseline.");
  if (JSON.stringify(local) !== JSON.stringify(manifest.migrations))
    throw new Error(
      "Local migration history differs from the reviewed release manifest.",
    );
  if (
    inspection.completedMigrations < manifest.baselineMigrationCount ||
    inspection.completedMigrations > names.length
  )
    throw new Error("Database is outside this release baseline.");
  const expected = names.slice(inspection.completedMigrations);
  if (
    JSON.stringify(expected) !== JSON.stringify(inspection.pendingMigrations) ||
    (inspection.status === "current") !== (expected.length === 0)
  )
    throw new Error("Database inspection is not the expected release suffix.");
  return {
    status: expected.length ? "pending" : "current",
    baselineCommit: manifest.baselineCommit,
    candidateCommit: manifest.candidateCommit,
    completedMigrations: inspection.completedMigrations,
    pendingMigrations: manifest.migrations.slice(inspection.completedMigrations),
    migrationExecuted: false,
  };
}
