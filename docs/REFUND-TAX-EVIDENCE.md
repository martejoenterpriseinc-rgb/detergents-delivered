# Refund tax report evidence

Staff can match an existing completed Stripe report to a saved refund settlement from Taxes. The server retrieves `tax.itemized_export.1` through the configured account, then downloads its file from the fixed authenticated Stripe Files endpoint. No report, refund, tax reversal or filing is created. CPA access remains read-only.

The report must contain the original Checkout purchase and the refund. Include every column listed in `taxReportColumns` in lib/commerce/tax-report.ts, including provider and automatic-calculation source, transaction identifiers, Payment Intent, original transaction, line item, total, tax and jurisdiction fields. Do not apply jurisdiction or other filters. Reports may take up to 24 hours to include completed transactions.

Matching requires the saved account/mode/payment/session/refund, original and reversal transaction links, currency, exact purchase/refund totals and exact tax amounts. Repeated line totals across jurisdictions are counted once while jurisdiction tax is summed. Missing rows, duplicate jurisdiction rows, imported/external calculations, ambiguous transactions, unsupported report types, mismatched amounts and malformed/oversized data fail closed. Downloads are bounded to 2 MB/10,000 rows and cannot follow redirects or caller-supplied URLs.

A successful match appends one immutable RefundTaxEvidence receipt and audit atomically. It stores provider IDs, report hash, account/mode and tax cents, not the report's customer data. Original refund accounting and its historical UNVERIFIED field are preserved. The Taxes screen reads the separate evidence receipt. Concurrent retry records one receipt. Tax evidence does not assert a tax return or amount due.

This increment matches SETTLEMENT entries only. Compensation/reversal-of-reversal report shapes require real provider acceptance and remain pending; they are never inferred from returned cash. Real report field availability and rounding must still be exercised against the connected account. No real Stripe report has been requested in this increment. Provider setup remains deferred.

Migration: 20260916150000_refund_tax_evidence. No hosted migration or deployment yet.

Sources checked 2026-09-11:
- https://docs.stripe.com/reports/report-types/tax
- https://docs.stripe.com/tax/reports
- https://docs.stripe.com/file-upload
