# QuickBooks financial reports and KPIs

Reports → QuickBooks → Financial reports and live KPIs reads ProfitAndLoss, BalanceSheet,
CashFlow, AgedReceivables, AgedPayables, InventoryValuationSummary and TrialBalance from
the authorized company. Report availability still depends on the company subscription and
provider authorization. No credentials are connected or provider records written by this build.

Day/week/month/year use Chicago business dates. Profit/loss and cash flow use the period
range. Balance, aging, inventory and trial balance reports are as-of the ending date;
current period choices therefore share today's ending balance. Cash/accrual controls are
provided for ProfitAndLoss, BalanceSheet and TrialBalance. The returned accounting basis,
company, realm, mode and check time are displayed.

Each provider summary monetary column becomes a KPI with a linked section detail screen.
Nested parent/child totals are never summed into invented global totals. Full returned rows
are displayed in the report table. Empty cells remain unavailable, explicit zero stays zero,
and NoReportData is shown as no data. Company-wide reports include everything in the
connected books; unposted application transactions are not silently blended into them.

The server requires finance access, current OAuth authorization, bounded fixed-host GETs,
matching report/date/basis/USD currency, complete column counts and unchanged authorization
and configuration after the provider read. It rejects overlarge, deeply nested, malformed or
filtered reports. Responses over 128 KB, 1,000 report nodes or 250 KPI cells require review;
no partial total is returned. Provider URLs and tokens are not forwarded to the browser.
The authenticated GET API shares the authoritative service and private response wrapper.

Validation covers monetary precision, empty versus zero, duplicate metadata, wrong scopes,
malformed/oversized reports, as-of dates, authorization revocation, configuration changes,
fixed read-only provider requests and response size limits. Real report acceptance against
all intended company reports and dedicated three-width visual review remain required.

Primary implementation references reviewed: Intuit's official PHP SDK Report.xsd,
ReportName.php and ReportService.php at commit 5bb480b505726d9f7b89ff0747b9acc629236a77:
https://github.com/intuit/QuickBooks-V3-PHP-SDK/tree/5bb480b505726d9f7b89ff0747b9acc629236a77/src
The provider documentation describes report limits and accounting basis reconciliation:
https://medium.com/intuitdev/quickbooks-online-reports-api-best-practices-and-troubleshooting-31edc9934b4c

Still open: dedicated tax liability/filing reports and payroll-specific reporting where
applicable, longer historical/custom-date selections, CSV/download workflows and report
pagination/chunking for larger companies. These screens do not certify books, tax returns,
provider posting completeness or production acceptance.
