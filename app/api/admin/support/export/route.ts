import { accountRequest, accountFailure } from "@/lib/account-api";
import { listSupportTickets } from "@/lib/services/support";
import { csvCell } from "@/lib/domain/account";
export async function GET(request: Request) {
  try {
    const result = await listSupportTickets(
      await accountRequest(),
      Object.fromEntries(new URL(request.url).searchParams),
      true,
      true,
    );
    const csv = [
      ["Ticket ID", "Order", "Subject", "Category", "Status", "Created", "Updated"],
      ...result.tickets.map((t) => [
        t.id,
        t.order?.number,
        t.subject,
        t.category,
        t.status,
        t.createdAt.toISOString(),
        t.updatedAt.toISOString(),
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="support-tickets.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return accountFailure(e);
  }
}
