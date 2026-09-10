// Explicit hosting-operator command. Never called by build/start/migrations/seed.
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { validateRuntimeConfig } from "../lib/runtime-config";
import {
  establishInitialOwner,
  initialOwnerInput,
} from "../lib/operations/initial-owner";

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      "user-id": { type: "string" },
      "approval-reference": { type: "string" },
      apply: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  validateRuntimeConfig(process.env);
  if (process.env.APP_ENV !== "production")
    throw new Error("This command is production-only.");
  const input = initialOwnerInput.parse({
    email: values.email,
    userId: values["user-id"],
    approvalReference: values["approval-reference"],
    apply: values.apply,
  });
  const db = new PrismaClient({ log: [] });
  try {
    const result = await establishInitialOwner(db, input);
    console.log(JSON.stringify(result));
    if (result.status === "READY_FOR_EXPLICIT_GRANT")
      console.log(
        "Read-only review passed. Grant only after explicit authorization for this exact verified account, using --apply.",
      );
    else
      console.log(
        "First-owner record confirmed. Sign in again to use the granted account.",
      );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Initial owner setup was not confirmed. Check production identity, exact verified account, prior staff access and explicit approval reference. No credentials are printed.",
  );
  process.exitCode = 1;
});
