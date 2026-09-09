import { validateRuntimeConfig } from "../lib/runtime-config";
import { prisma } from "../lib/prisma";
import {
  deliverRecoveryEmails,
  runtimeRecoveryEmailConfiguration,
} from "../lib/services/password-recovery";

async function main() {
  try {
    validateRuntimeConfig(process.env);
    await runtimeRecoveryEmailConfiguration();
    const result = await deliverRecoveryEmails(20);
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } catch {
    // Never write recipient addresses, tokens, API keys, or provider bodies to logs.
    console.error(
      "Recovery email delivery could not complete. Check configuration and retry.",
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
void main();
