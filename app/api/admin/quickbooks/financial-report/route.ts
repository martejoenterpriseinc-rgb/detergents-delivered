import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { quickbooksFinancialReport } from "@/lib/services/quickbooks-financial-report";
import { financialReportRows } from "@/lib/domain/quickbooks-financial-report";
import { writeCsv } from "@/lib/domain/csv";
import { z } from "zod";
import { AccountError } from "@/lib/domain/account";
export async function GET(request: Request) {
  try {
    const actor = await accountRequest(request),
      params = new URL(request.url).searchParams;
    const format = z.enum(["json", "csv"]).parse(params.get("format") ?? "json");
    const section = z
      .string()
      .max(100)
      .optional()
      .parse(params.get("section") ?? undefined);
    const data = await quickbooksFinancialReport(actor, {
      report: params.get("report") ?? undefined,
      period: params.get("period") ?? undefined,
      basis: params.get("basis") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    if (format === "json") return accountJson(data);
    if (
      section &&
      data.metrics.find((metric) => metric.section === section)?.label !==
        params.get("sectionLabel")
    )
      throw new AccountError(
        "This report section changed. Refresh before exporting.",
        409,
      );
    const rows = financialReportRows(data, section);
    const metadata = [
      data.company,
      data.realm,
      data.mode,
      data.name,
      data.period.from,
      data.period.to,
      data.header.ReportBasis ?? "Provider report basis",
      "USD",
      data.checkedAt,
    ];
    return new Response(
      writeCsv([
        [
          "Company",
          "Company ID",
          "Environment",
          "Report",
          "Requested start",
          "Report end",
          "Accounting basis",
          "Currency",
          "Checked at UTC",
          "Section",
          "Row kind",
          "Depth",
          ...data.columns.map((c) => c.ColTitle),
        ],
        ...(data.noData
          ? [[...metadata, "", "NO_REPORT_DATA", "", ...data.columns.map(() => "")]]
          : rows.map((row) => [
              ...metadata,
              row.section,
              row.kind,
              row.depth,
              ...row.values,
            ])),
      ]),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="quickbooks-${data.name}-${data.period.to}.csv"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return accountFailure(error);
  }
}
