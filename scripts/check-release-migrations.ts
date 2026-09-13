import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { reviewReleaseMigrations } from "../lib/release-migration-review";

async function main() {
  const manifest = JSON.parse(await readFile("deploy/release-migrations.json", "utf8"));
  const entries = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const local = await Promise.all(
    entries.map(async (entry) => ({
      name: entry.name,
      checksum: createHash("sha256")
        .update(await readFile(`prisma/migrations/${entry.name}/migration.sql`))
        .digest("hex"),
    })),
  );
  let output: string;
  try {
    output = (
      await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "scripts/check-database.ts"],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      )
    ).stdout;
  } catch (error) {
    output = (error as { stdout?: string }).stdout ?? "";
  }
  const result = reviewReleaseMigrations(manifest, local, JSON.parse(output));
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "current") process.exitCode = 2;
}
main().catch(() => {
  console.error(
    "Release review blocked: verify the manifest, retained database history and private connection. No migrations or database writes were attempted.",
  );
  process.exitCode = 1;
});
