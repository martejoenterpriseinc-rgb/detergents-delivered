import { setTimeout as pause } from "node:timers/promises";
import { prisma } from "../lib/prisma";
import { validateRuntimeConfig } from "../lib/runtime-config";
import {
  ENVIRONMENT_KEY,
  validateDatabaseEnvironment,
} from "../lib/database-environment";
import { runOperationalTask } from "../lib/operations/work";
import { jobNames } from "../lib/operations/jobs";
let stopping = false;
const stop = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stopping = true;
    stop.abort();
  });
async function main() {
  validateRuntimeConfig(process.env);
  const marker = await prisma.setting.findUnique({ where: { key: ENVIRONMENT_KEY } });
  validateDatabaseEnvironment(
    marker?.valueJson,
    process.env.APP_ENV!,
    decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1)),
  );
  await Promise.all(
    jobNames.map(async (name) => {
      while (!stopping) {
        try {
          const result = await runOperationalTask(name);
          if (result.claimed) console.log(JSON.stringify({ job: name, ...result }));
        } catch {
          console.error(
            "Operational scheduler cycle failed. Check service health; no private details logged.",
          );
        }
        if (process.argv.includes("--once")) break;
        try {
          await pause(15_000, undefined, { signal: stop.signal });
        } catch {
          /* graceful stop */
        }
      }
    }),
  );
}
main()
  .catch(() => {
    console.error("Operational scheduler could not start.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
