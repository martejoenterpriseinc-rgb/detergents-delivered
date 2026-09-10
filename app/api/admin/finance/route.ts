import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { readFinance, saveFinance } from "@/lib/services/finance";
import { csvCell } from "@/lib/domain/account";

export async function GET(request: Request) {
  try {
    const { kind, format, ...filters } = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    if (format && format !== "csv")
      return accountJson({ error: "Unsupported export format." }, 400);
    const result = await readFinance(
      await accountRequest(),
      kind,
      filters,
      format === "csv",
    );
    if (format !== "csv") return accountJson(result);
    const rows: unknown[][] = [
      [
        "Record ID",
        "Date",
        "Category / vehicle",
        "Memo / purpose",
        "Amount",
        "Unit / currency",
        "Start odometer",
        "End odometer",
        "Revision",
      ],
      ...result.rows.map((r) => [
        r.id,
        r.date,
        r.label,
        r.description,
        r.amount,
        r.currency,
        r.startOdometer ?? "",
        r.endOdometer ?? "",
        r.version,
      ]),
    ];
    return new Response(rows.map((r) => r.map(csvCell).join(",")).join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.kind}-${result.filters.from}-${result.filters.to}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return accountFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await saveFinance(await accountRequest(request), await readAccountJson(request)),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
