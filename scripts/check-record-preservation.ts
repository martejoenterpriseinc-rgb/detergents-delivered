import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import {
  recordCheckpoint,
  recordCheckpointSchema,
  compareRecordCheckpoints,
} from "../lib/database-record-checkpoint";
import { validateRuntimeConfig } from "../lib/runtime-config";
import {
  ENVIRONMENT_KEY,
  validateDatabaseEnvironment,
} from "../lib/database-environment";

async function main() {
  const [action, path, ...extra] = process.argv.slice(2);
  if (!["capture", "verify"].includes(action) || !path || extra.length)
    throw new Error("Use capture <new-file.json> or verify <existing-file.json>.");
  validateRuntimeConfig(process.env);
  const url = new URL(process.env.DATABASE_URL!);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const identity = {
    environment: process.env.APP_ENV!,
    databaseHash: createHash("sha256")
      .update(url.hostname + ":" + (url.port || "5432") + "/" + databaseName)
      .digest("hex"),
  };
  const db = new PrismaClient({ log: [] });
  try {
    const marker = await db.setting.findUnique({ where: { key: ENVIRONMENT_KEY } });
    validateDatabaseEnvironment(marker?.valueJson, identity.environment, databaseName);
    const before =
      action === "verify"
        ? recordCheckpointSchema.parse(JSON.parse(await readFile(path, "utf8")))
        : undefined;
    const result = await recordCheckpoint(db, identity, before);
    if (before) {
      const changed = compareRecordCheckpoints(before, result);
      console.log(
        JSON.stringify({
          status: changed.length ? "changed" : "preserved",
          checkedTables: result.tables.length,
          changedTables: changed,
        }),
      );
      if (changed.length) process.exitCode = 1;
    } else {
      await writeFile(path, JSON.stringify(result, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      console.log(
        JSON.stringify({ status: "captured", checkedTables: result.tables.length }),
      );
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Record verification could not complete. Check the command, private database configuration and checkpoint file. No database writes were attempted.",
  );
  process.exitCode = 1;
});
