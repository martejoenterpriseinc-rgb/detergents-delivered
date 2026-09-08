export type LocalMigration = { name: string; checksum: string };
export type AppliedMigration = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export function assessDatabaseHistory(
  tables: string[],
  applied: AppliedMigration[],
  local: LocalMigration[],
) {
  const problems: string[] = [];
  const empty = tables.length === 0;
  if (!empty && !tables.includes("_prisma_migrations"))
    problems.push("Untracked existing schema; do not initialize or reset it.");
  const finished = new Set<string>();
  for (const row of applied) {
    if (row.rolled_back_at) continue;
    const expected = local.find((migration) => migration.name === row.migration_name);
    if (!expected)
      problems.push(
        "Database contains migration history from a different source revision.",
      );
    else if (expected.checksum !== row.checksum)
      problems.push("Applied migration checksum differs from retained SQL.");
    if (!row.finished_at)
      problems.push("An unfinished migration requires recovery review.");
    else if (finished.has(row.migration_name))
      problems.push("Duplicate completed migration history requires review.");
    else finished.add(row.migration_name);
  }
  if (
    !empty &&
    tables.some((table) => table !== "_prisma_migrations") &&
    finished.size === 0
  )
    problems.push("Existing application tables have no completed migration baseline.");
  let pendingSeen = false;
  for (const migration of local) {
    if (!finished.has(migration.name)) pendingSeen = true;
    else if (pendingSeen)
      problems.push(
        "Applied migrations are not an ordered prefix of this source history.",
      );
  }
  return {
    status: problems.length
      ? "blocked"
      : empty
        ? "empty"
        : local.every((migration) => finished.has(migration.name))
          ? "current"
          : "pending",
    tableCount: tables.length,
    completedMigrations: finished.size,
    pendingMigrations: local
      .filter((migration) => !finished.has(migration.name))
      .map((migration) => migration.name),
    problems: [...new Set(problems)],
  };
}
