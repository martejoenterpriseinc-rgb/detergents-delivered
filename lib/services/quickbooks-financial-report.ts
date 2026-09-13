import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { authorizedQuickbooks, assertQuickbooksSnapshot } from "./quickbooks-connection";
import {
  quickbooksConfig,
  verifyQuickbooksCompany,
  readQuickbooksFinancialReportData,
} from "@/lib/integrations/quickbooks-client";
import {
  financialReportFilters,
  parseFinancialReport,
} from "@/lib/domain/quickbooks-financial-report";
import { AccountError } from "@/lib/domain/account";
export async function quickbooksFinancialReport(
  actor: string,
  raw: {
    report?: unknown;
    period?: unknown;
    basis?: unknown;
    from?: unknown;
    to?: unknown;
  },
) {
  await financeAccess(prisma, actor);
  const { report: name, range: period, basis } = financialReportFilters(raw);
  const snapshot = await authorizedQuickbooks(actor);
  const request = { name, from: period.from, to: period.to, basis };
  const company = await verifyQuickbooksCompany(snapshot.config, snapshot.accessToken);
  const report = parseFinancialReport(
    await readQuickbooksFinancialReportData(
      snapshot.config,
      snapshot.accessToken,
      request,
    ),
    request,
  );
  if ((await quickbooksConfig()).fingerprint !== snapshot.config.fingerprint)
    throw new AccountError(
      "QuickBooks company settings changed. Reload this report.",
      409,
    );
  await prisma.$transaction((tx) => assertQuickbooksSnapshot(tx, actor, snapshot));
  return {
    ...report,
    name,
    period,
    basis,
    company,
    realm: snapshot.config.realm,
    mode: snapshot.config.mode,
    checkedAt: new Date().toISOString(),
  };
}
