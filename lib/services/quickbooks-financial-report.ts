import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { financeAccess } from "./finance";
import { authorizedQuickbooks, assertQuickbooksSnapshot } from "./quickbooks-connection";
import {
  quickbooksConfig,
  verifyQuickbooksCompany,
  readQuickbooksFinancialReportData,
} from "@/lib/integrations/quickbooks-client";
import {
  financialReportName,
  parseFinancialReport,
} from "@/lib/domain/quickbooks-financial-report";
import { paymentPeriod } from "@/lib/domain/payment-overview";
import { AccountError } from "@/lib/domain/account";
export async function quickbooksFinancialReport(
  actor: string,
  raw: { report?: unknown; period?: unknown; basis?: unknown },
) {
  await financeAccess(prisma, actor);
  const name = financialReportName.parse(raw.report ?? "ProfitAndLoss"),
    period = paymentPeriod(raw.period),
    basis = z.enum(["Cash", "Accrual"]).parse(raw.basis ?? "Accrual");
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
