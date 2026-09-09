import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { validateRuntimeConfig } from "../lib/runtime-config";
import {
  ENVIRONMENT_KEY,
  validateDatabaseEnvironment,
} from "../lib/database-environment";
import { productionProvisioningAction } from "../lib/production-provisioning";
const execute = promisify(execFile);
async function run(args: string[], extra: Record<string, string> = {}) {
  // Capture child output to avoid forwarding configuration or raw database errors.
  await execute(process.execPath, args, {
    env: { ...process.env, ...extra },
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
}
async function main() {
  validateRuntimeConfig(process.env);
  if (process.env.APP_ENV !== "production")
    throw new Error("Production provisioning only.");
  const db = new PrismaClient({ log: [] });
  let action: "initialize" | "preflight";
  try {
    const tables = await db.$queryRaw<
      { tablename: string }[]
    >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    const marker = tables.some((t) => t.tablename === "Setting")
      ? await db.setting.findUnique({ where: { key: ENVIRONMENT_KEY } })
      : null;
    if (marker)
      validateDatabaseEnvironment(
        marker.valueJson,
        "production",
        decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1)),
      );
    action = productionProvisioningAction(
      tables.map((t) => t.tablename),
      Boolean(marker),
    );
  } finally {
    await db.$disconnect();
  }
  if (action === "initialize") {
    await run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
    await run(["--import", "tsx", "scripts/initialize-empty-environment.ts"], {
      DD_INITIALIZE_EMPTY_DATABASE: "true",
    });
  }
  await run(["--import", "tsx", "scripts/check-database.ts"]);
  console.log(
    "Production database identity and migration history passed. No demo data, users or business records were seeded.",
  );
}
main().catch(() => {
  console.error(
    "Production provisioning stopped. Inspect database history and pinned configuration; existing data was not reset.",
  );
  process.exitCode = 1;
});
