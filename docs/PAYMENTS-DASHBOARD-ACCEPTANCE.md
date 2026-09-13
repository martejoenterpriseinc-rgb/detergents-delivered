# Payments dashboard completion

## Source and production

The September 13 read-only Render inspection confirmed production deploy
`dep-dai22sp594qs73e32pig`, source `a2495c4afa459a9c258804841fa37b038ecdd828`.
Its health endpoint returned production/healthy. The screenshot's three-card page is
from this older release. PR75 implemented ten KPI drilldowns but is still in the open
release chain. This continuation extends that same `/admin/payments` implementation
on top of PR83, not a competing dashboard.

## Delivered scope

Thirty clickable categories cover collected gross/net, signed order refund entries,
payment/refund states, cash/Zelle, manual pending/exception records, tip collection,
refund and transfer records, balances, fees and customers. Every category has a detail
route and filtered CSV export. Unsupported evidence is explicitly unavailable, including
declines, fraud blocks, canceled provider payments, disputes, processing fees and provider
payouts. Cash/Zelle approval permissions exist, but no scoped customer request queue exists;
the Pending approvals card explains that limitation rather than inferring requests.

Date presets include today, yesterday, Monday-based week, month to date, previous month
and year; custom inclusive Chicago business dates are limited to one year. Filters,
search, deterministic sorting, pagination and export share the same backend query.
Comparisons cover the preceding equal count of calendar days, including DST boundaries.
Trend buckets include zero-activity dates. Top-customer links open underlying net records.

## Definitions and evidence

- Gross: finalized USD order payments with the saved paid event, including sales tax,
  excluding separately charged tips and redeemed rewards. Cash/Zelle require matching
  settled receipts and use receivedAt; card payments use placedAt. No latest-100 cap.
- Refunds: signed settlement/compensation ledger entries dated by posting; not the sum
  of requests plus refund objects. Reward-only returns carry no cash and are excluded.
- Net: gross minus signed refunds in the period. Refund detail entries are negative in
  the net drilldown; corrections restore them. Net is neither profit nor bank deposits.
- Customer spend: period net order collections, excluding tips. New paying customers
  use their first recorded capture in the selected environment/account, before method
  and text filters. Cards count distinct customers.
- Processing: pending payment records and processing checkouts without duplicate payment
  rows. No completed payment is inferred from an open checkout. Manual PREPARING records
  show separately as pending manual payments; unfinished received-money settlements are
  review records. Amounts without a payment/receipt remain unavailable.
- Refund request counts: pending includes prepared drafts; completion/failure follows
  durable request state. A canceled unused draft is excluded from failed refunds.
- Tips: saved paid Stripe audit evidence is required. Collected tip principal excludes
  tax; recorded successful tip refunds include tax and use their first successful audit
  date. This is the locally recorded refund history, not exhaustive provider discovery.
  Driver payouts are signed staff-confirmed entries using paidOn. Current payable amounts
  cannot be certified without provider refund/dispute checks and remain unavailable.
- Available/pending balances are current account-wide provider observations, not filtered
  order collections. Unsupported metrics have no fabricated zero or screenshot amounts.

This is an operational ledger, not a replacement for strict CPA export source certification.
All aggregates execute on the server in one read-only repeatable-read snapshot with fresh
Admin/SuperAdmin authorization. No report initiates money movement or provider writes.
Exports recheck the same authorization, escape spreadsheet formulas, avoid shared caches,
and reject more than 10,000 rows with a narrow-filter instruction rather than truncate.
Large aggregate values must remain exact safe integers. Database queries have timeouts.

## Validation and deployment gates

Unit checks cover dates, DST, invalid filters and query preservation. PostgreSQL coverage
checks signed correction math, mode/account scoping, cash/Zelle, search, permissions,
more than 100 records and full matching exports. Browser acceptance exercises every KPI
and CSV route, filter controls and three widths. Exact revision/CI evidence is recorded
in the PR after the run completes.

No APIs were connected or activation flags changed. Production remains on the older
revision until the full intervening migration chain is reviewed and backed up: current
recoverable backup/encryption keys, write/worker quiescence, retained-record checkpoint,
ordered migration execution and retained-data comparison, exact release acceptance and
controlled restoration of traffic. Do not run the old two-migration release procedure
against this larger chain, trigger the stale configured branch, or bypass preflight.
Provider-dependent metric acceptance and end-to-end production acceptance remain open.
