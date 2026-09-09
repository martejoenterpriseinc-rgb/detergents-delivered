import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { validateRuntimeConfig } from "../lib/runtime-config";
import { assessDatabaseHistory, type AppliedMigration } from "../lib/database-history";
import {
  ENVIRONMENT_KEY,
  validateDatabaseEnvironment,
} from "../lib/database-environment";

async function main() {
  validateRuntimeConfig(process.env);
  const root = resolve("prisma/migrations");
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const local = await Promise.all(
    entries.map(async (entry) => ({
      name: entry.name,
      checksum: createHash("sha256")
        .update(await readFile(join(root, entry.name, "migration.sql")))
        .digest("hex"),
    })),
  );
  const db = new PrismaClient({ log: [] });
  try {
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
        const tables = await tx.$queryRaw<
          Array<{ table_name: string }>
        >`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
        const names = tables.map((table) => table.table_name);
        const marker = names.includes("Setting")
          ? await tx.setting.findUnique({ where: { key: ENVIRONMENT_KEY } })
          : null;
        validateDatabaseEnvironment(
          marker?.valueJson,
          process.env.APP_ENV!,
          decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1)),
        );
        const applied = names.includes("_prisma_migrations")
          ? await tx.$queryRaw<
              AppliedMigration[]
            >`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`
          : [];
        return assessDatabaseHistory(names, applied, local);
      },
      { timeout: 10000 },
    );
    console.log(JSON.stringify(result, null, 2));
    // Empty/pending are review results, not permission to initialize/migrate.
    if (result.status !== "current") process.exitCode = 1;
  } catch {
    console.error(
      "Database inspection failed. Check the private connection and database permissions in Render. No migrations or writes were attempted.",
    );
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error(
    "Database preflight could not start. Run npm run check:runtime and verify local migration files. No writes were attempted.",
  );
  process.exitCode = 1;
});
