import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { refundMigrationAction } from "../lib/refund-migration-gate";

const execute = promisify(execFile);
async function inspect() {
  let output: string;
  try {
    output = (
      await execute(process.execPath, ["--import", "tsx", "scripts/check-database.ts"])
    ).stdout;
  } catch (error) {
    // The read-only inspector exits 1 for pending migrations. Other failures
    // cannot produce an acceptable structured inspection and remain blocked.
    output = (error as { stdout?: string }).stdout ?? "";
  }
  return JSON.parse(output);
}

async function main() {
  const action = refundMigrationAction(await inspect());
  if (action === "migrate") {
    await execute(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
    );
  }
  if (refundMigrationAction(await inspect()) !== "current")
    throw new Error("Migrations remain pending.");
  console.log(
    "Reviewed refund migrations and database identity verified. No business records were seeded.",
  );
}

main().catch(() => {
  console.error(
    "Refund foundation deployment stopped: database identity, history or reviewed migrations need attention.",
  );
  process.exitCode = 1;
});
