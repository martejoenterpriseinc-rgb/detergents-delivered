import { accountRequest, accountFailure } from "@/lib/account-api";
import { paymentCategory } from "@/lib/domain/payment-overview";
import { readPaymentOverview } from "@/lib/services/payment-overview";
import { writeCsv } from "@/lib/domain/csv";
export async function GET(request: Request) {
  try {
    const actor = await accountRequest(),
      query = Object.fromEntries(new URL(request.url).searchParams),
      category = paymentCategory.parse(query.category);
    delete query.category;
    const data = await readPaymentOverview(actor, query, category, true);
    return new Response(
      writeCsv([
        [
          "Category",
          "Environment",
          "Customer",
          "Email",
          "Order",
          "Method",
          "Status",
          "Reference",
          "Date UTC",
          "Amount USD",
        ],
        ...data.rows.map((r) => [
          category,
          data.live ? "production" : "sandbox",
          r.customer,
          r.email,
          r.number ?? "",
          r.method,
          r.status,
          r.reference ?? r.id,
          r.date,
          r.cents === null ? "Unavailable" : (r.cents / 100).toFixed(2),
        ]),
      ]),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="payments-${category}.csv"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (e) {
    return accountFailure(e);
  }
}
