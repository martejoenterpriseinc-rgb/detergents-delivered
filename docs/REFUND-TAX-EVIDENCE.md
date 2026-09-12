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

## Failed-refund investigation — September 11, 2026

Stripe's custom PaymentIntents Tax guide documents reversing a partial tax reversal with a full reversal of that reversal. Its example produces positive amounts tied to the original refund tax transaction. The same guide directs Checkout integrations to use native tax integration instead. This application uses Checkout automatic tax, so the custom example alone does not establish the permitted correction or report shape here.

Before adding compensation evidence, exercise the intended Checkout integration in an isolated provider environment and retain the original sale, settled refund, later failed/canceled refund event, failure balance transaction, refund tax reversal, and any provider-generated correction. Confirm the correction's account/mode, parent transaction, currency, signed line/tax totals and unique identity. If native Checkout does not supply a verifiable correction, obtain provider guidance before introducing a tax-writing adapter. Returned cash alone must never mark compensation tax as matched.

The current implementation retains the signed application compensation and flags any already-posted QuickBooks refund for correction review. It does not create another sale, void a provider receipt, or manually reverse Checkout tax based on this research.

## Immediate accounting correction warnings

Verified refund compensation now flags its active QuickBooks refund export in the same database transaction as the cash/tax/reward correction. The warning and its audit must succeed or the entire local compensation rolls back. A repeated verified reconciliation can backfill a missing warning without duplicating the audit. Original receipt source, payload, external ID and confirmation remain unchanged; the original sale receipt is not flagged by this action.

Submission/recovery read failures retain `REFUND_COMPENSATION_REVIEW` instead of replacing it with a generic unconfirmed-evidence message. Native regression coverage includes immediate marking, duplicate replay, audit-failure rollback and a later provider read outage. These changes preserve the correction obligation; they do not assert that Stripe Tax or QuickBooks has accepted an external correcting transaction. Provider correction matching/posting remains pending the deferred account setup and supported Checkout evidence.

Primary references:
- [Custom Tax API: undo a partial refund](https://docs.stripe.com/tax/payment-intent/custom#undo-a-partial-refund)
- [Tax reversal API](https://docs.stripe.com/api/tax/transactions/create_reversal)
- [Failed refunds](https://docs.stripe.com/refunds#handle-failed-refunds)
