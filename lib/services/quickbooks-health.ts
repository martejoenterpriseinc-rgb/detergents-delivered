import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { authorizedQuickbooks, assertQuickbooksSnapshot } from "./quickbooks-connection";
import {
  quickbooksConfig,
  verifyQuickbooksCompany,
} from "@/lib/integrations/quickbooks-client";
export async function quickbooksHealth(actor: string) {
  await financeAccess(prisma, actor);
  try {
    const snapshot = await authorizedQuickbooks(actor);
    await verifyQuickbooksCompany(snapshot.config, snapshot.accessToken);
    const current = await quickbooksConfig();
    if (current.fingerprint !== snapshot.config.fingerprint)
      throw Error("Configuration changed");
    await prisma.$transaction((tx) => assertQuickbooksSnapshot(tx, actor, snapshot));
    return {
      connected: true,
      message: `QuickBooks API verified for company ${snapshot.config.realm} (${snapshot.config.mode}).`,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      connected: false,
      message:
        "QuickBooks connection could not be verified. Review the company authorization and retry.",
      checkedAt: new Date().toISOString(),
    };
  }
}
