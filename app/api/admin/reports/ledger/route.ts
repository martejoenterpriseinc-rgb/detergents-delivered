import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { writeCsv } from "@/lib/domain/csv";
import { readCpaLedger } from "@/lib/services/cpa-ledger";
export async function GET(request: Request) {
  try {
    const { format, ...filters } = Object.fromEntries(new URL(request.url).searchParams);
    if (format && format !== "csv")
      return accountJson({ error: "Unsupported export format." }, 400);
    const result = await readCpaLedger(await accountRequest(), filters, format === "csv");
    if (format !== "csv") return accountJson(result);
    const money = (v: number | null) => (v === null ? "" : (v / 100).toFixed(2));
    const rows: (string | number)[][] = [
      [
        "Source ID",
        "Order ID",
        "Order",
        "Business date",
        "Event",
        "Currency",
        "Environment",
        "Cash change",
        "Merchandise after savings change",
        "Tax allocation change",
        "Reward credit change",
        "COGS change",
        "Original sale merchandise",
        "Original sale promotion savings",
        "Tax evidence",
        "Review issues",
      ],
      ...result.rows.map((r) => [
        r.sourceId,
        r.orderId,
        r.number,
        r.date,
        r.kind,
        "USD",
        result.mode,
        money(r.cashCents),
        money(r.netCents),
        money(r.taxCents),
        money(r.rewardCents),
        money(r.costCents),
        money(r.subtotalCents),
        money(r.promotionCents),
        r.taxEvidence,
        r.issues.join("; "),
      ]),
    ];
    return new Response(writeCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="financial-ledger-${result.filter.from}-${result.filter.to}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return accountFailure(e);
  }
}
