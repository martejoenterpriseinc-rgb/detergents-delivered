import Link from "next/link";
import type { Route } from "next";
import { Card } from "@/components/ui/card";
import {
  SUPPORT_LABELS,
  SUPPORT_STATUSES,
  supportFilterSchema,
} from "@/lib/domain/account";
import { listSupportTickets, getSupportTicket } from "@/lib/services/support";
import { TicketReplyForm } from "./forms";
const date = (v: Date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(v);
export async function SupportList({
  userId,
  staff,
  search,
}: {
  userId: string;
  staff: boolean;
  search: Record<string, string | string[] | undefined>;
}) {
  const parsed = supportFilterSchema.safeParse(search);
  if (!parsed.success)
    return (
      <Card>
        <p role="alert">Invalid filters. Clear them to view tickets.</p>
        <Link href={staff ? "/admin/support" : "/account/support"}>Clear filters</Link>
      </Card>
    );
  const filters = parsed.data;
  const result = await listSupportTickets(userId, filters, staff);
  const base = staff ? "/admin/support" : "/account/support";
  const query = new URLSearchParams({
    status: filters.status,
    q: filters.q,
    sort: filters.sort,
  });
  return (
    <div className="space-y-5">
      <form className="grid grid-cols-1 items-end gap-3 rounded-2xl border border-teal-100 bg-white p-4 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_auto_auto_auto]">
        <label className="min-w-0 flex-1 text-sm font-semibold">
          Lookup
          <input
            name="q"
            defaultValue={filters.q}
            maxLength={100}
            placeholder={
              staff ? "Ticket, order, subject, or email" : "Ticket, order, or subject"
            }
            className="mt-1 w-full rounded-xl border border-teal-200 p-3 font-normal"
          />
        </label>
        <label className="text-sm font-semibold">
          Status
          <select
            name="status"
            defaultValue={filters.status}
            className="mt-1 block w-full max-w-full rounded-xl border border-teal-200 p-3 font-normal"
          >
            <option value="ACTIVE">All active</option>
            <option value="ALL">All tickets</option>
            {SUPPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SUPPORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Sort
          <select
            name="sort"
            defaultValue={filters.sort}
            className="mt-1 block w-full rounded-xl border border-teal-200 p-3 font-normal"
          >
            <option value="updated">Last updated</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
        <button className="min-h-11 rounded-full bg-teal-700 px-5 font-semibold text-white">
          Apply filters
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-teal-700">
          {result.total} matching tickets · page {result.page}
        </p>
        {staff && (
          <a
            href={`/api/admin/support/export?${query}`}
            className="font-semibold text-teal-800 underline"
          >
            Export filtered CSV
          </a>
        )}
      </div>
      {!result.tickets.length && <Card>No tickets match these filters.</Card>}
      {result.tickets.map((t) => (
        <Link
          key={t.id}
          href={`${base}/${t.id}` as Route}
          className="block rounded-3xl focus-visible:outline-2 focus-visible:outline-teal-700"
        >
          <Card className="space-y-2 hover:bg-teal-50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="font-semibold break-words">{t.subject}</h2>
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold">
                {SUPPORT_LABELS[t.status]}
              </span>
            </div>
            <p className="text-sm break-all text-teal-700">
              {t.order?.number ?? "General question"} · {t.category} · {t.id}
            </p>
            <p className="text-sm text-teal-700">Updated {date(t.updatedAt)} Central</p>
          </Card>
        </Link>
      ))}
      <nav aria-label="Ticket pages" className="flex justify-between gap-4">
        {result.page > 1 && (
          <Link
            href={`${base}?${query}&page=${result.page - 1}` as Route}
            className="font-semibold underline"
          >
            Previous
          </Link>
        )}
        {result.page * 25 < result.total && (
          <Link
            href={`${base}?${query}&page=${result.page + 1}` as Route}
            className="font-semibold underline"
          >
            Next
          </Link>
        )}
      </nav>
    </div>
  );
}
export function SupportThread({
  ticket,
  staff,
}: {
  ticket: Awaited<ReturnType<typeof getSupportTicket>>;
  staff: boolean;
}) {
  return (
    <div className="space-y-5">
      <Card className="space-y-2">
        <h1 className="text-2xl font-semibold break-words">{ticket.subject}</h1>
        <p>
          {SUPPORT_LABELS[ticket.status]} · {ticket.category}
        </p>
        <p className="text-sm break-all text-teal-700">
          {ticket.order?.number ?? "General question"} · Ticket {ticket.id}
        </p>
        <p className="text-sm text-teal-700">Created {date(ticket.createdAt)} Central</p>
      </Card>
      <section aria-label="Conversation" className="space-y-3">
        {ticket.messages.length === 200 && (
          <p className="text-sm">Showing the latest 200 messages.</p>
        )}
        {ticket.messages.map((m) => (
          <Card key={m.id} className={m.isStaff ? "bg-teal-50" : ""}>
            <p className="text-sm font-semibold">
              {m.isStaff ? "Detergents Delivered support" : "Customer"}
            </p>
            <p className="mt-2 text-sm break-words whitespace-pre-wrap text-teal-900">
              {m.body}
            </p>
            <p className="mt-3 text-xs text-teal-700">{date(m.createdAt)} Central</p>
          </Card>
        ))}
      </section>
      <Card>
        <TicketReplyForm
          key={ticket.version}
          ticketId={ticket.id}
          version={ticket.version}
          status={ticket.status}
          staff={staff}
        />
      </Card>
    </div>
  );
}
