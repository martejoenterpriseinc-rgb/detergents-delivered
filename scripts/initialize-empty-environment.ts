// Explicit owner-run provisioning step. Never called by build/start/migrations/seed.
import { PrismaClient } from "@prisma/client";
import { validateRuntimeConfig } from "../lib/runtime-config";
import {
  ENVIRONMENT_KEY,
  validateDatabaseEnvironment,
} from "../lib/database-environment";
async function main() {
  validateRuntimeConfig(process.env);
  if (process.env.DD_INITIALIZE_EMPTY_DATABASE !== "true")
    throw new Error("Explicit empty-database initialization opt-in is required.");
  const db = new PrismaClient({ log: [] });
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(613279106)`;
        const name = decodeURIComponent(
          new URL(process.env.DATABASE_URL!).pathname.slice(1),
        );
        const marker = await tx.setting.findUnique({ where: { key: ENVIRONMENT_KEY } });
        if (marker) {
          validateDatabaseEnvironment(marker.valueJson, process.env.APP_ENV!, name);
          return;
        }
        const tables = await tx.$queryRaw<
          { tablename: string }[]
        >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
        // Read only counts; identifiers originate from PostgreSQL metadata and are quoted.
        for (const table of tables) {
          const quoted = '"' + table.tablename.replaceAll('"', '""') + '"';
          const rows = await tx.$queryRawUnsafe<{ present: boolean }[]>(
            `SELECT EXISTS(SELECT 1 FROM ${quoted} LIMIT 1) AS present`,
          );
          if (rows[0]?.present)
            throw new Error(
              "Database contains application data. Refusing to classify or reuse it as a clean environment.",
            );
        }
        await tx.setting.create({
          data: {
            key: ENVIRONMENT_KEY,
            valueJson: {
              project: "detergents-delivered",
              environment: process.env.APP_ENV!,
              databaseName: name,
            },
          },
        });
      },
      { isolationLevel: "Serializable", timeout: 30000 },
    );
    console.log(
      "Database environment identity is initialized. No customer, order or catalog records were copied.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Environment initialization failed. Check explicit opt-in, runtime settings and an empty database. No success is claimed; no connection details are printed.",
  );
  process.exitCode = 1;
});
