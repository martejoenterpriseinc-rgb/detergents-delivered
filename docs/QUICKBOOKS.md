# QuickBooks Online

Accounting integration contract. Company authorization is implemented in `QUICKBOOKS-CONNECTION.md`; expense account mapping in `QUICKBOOKS-ACCOUNT-MAPPING.md`; reviewed one-line expense posting/reconciliation in `QUICKBOOKS-EXPENSE-POSTING.md`. Submission defaults off. Sales/refund/COGS and other accounting workflows remain unfinished. No real provider acceptance is implied.

## Source of truth

| Concern | System of record | QBO role |
| --- | --- | --- |
| Inventory on-hand / reserved | Operational DB (ledger) | Optional item qty sync — never authoritative |
| Orders, tax, payments, refunds | Operational DB | Sales receipts / payments / refund receipts |
| Landed cost / COGS | Operational DB | Journal or item receipt after we compute it |
| Chart of accounts, bank rec, 1099s | QBO | Source of truth for *books presentation* |
| Customer delivery address | Operational DB | Customer display name / billing only |

If QBO and the app disagree on stock, **the app wins**. If they disagree on a bank deposit after reconciliation, investigate — do not blindly overwrite either side.

## Planned mappings

| App entity | QBO object (sandbox first) |
| --- | --- |
| Customer | Customer |
| ProductVariant | Item (non-inventory or inventory-sku, TBD) |
| Order (paid) | SalesReceipt or Invoice + Payment |
| Refund | RefundReceipt |
| TaxCalculation | Tax line / tax code (Stripe Tax snapshot copied, not recalculated) |
| Expense | Purchase / Expense |
| Mileage | (usually not pushed; report in-app) |
| Vendor + PO/Receipt | Bill / Item receipt (if we enable QBO purchasing) |

Expense exports now retain immutable external IDs in `QboExpenseExport`, scoped to environment and company, with a protected `Expense.qboTxnId` link. Legacy `ExpenseCategory.qboAccountId` values are preserved; reviewed mappings use the company-scoped mapping store. Other entity mappings remain planned.

## Idempotent sync plan

1. Every outbound payload gets an idempotency key: `{entityType}:{entityId}:{version}` or the payment `idempotencyKey`.
2. Persist `externalId` before treating sync as done.
3. An uncertain provider write remains protected for read-only reconciliation. Workers must not retry a fresh create request or create a second accounting transaction. The implemented expense worker reads evidence and refreshes tokens using durable claims; see `QUICKBOOKS-SCHEDULED-RECONCILIATION.md`.
4. Inbound QBO webhooks (if enabled) verify `QBO_WEBHOOK_VERIFIER_TOKEN` and only update sync status — they do not mutate inventory.
5. Sandbox (`QBO_ENVIRONMENT=sandbox`) is mandatory in development and staging. Production company id is a production-only secret.

## What we will not do

- Use QBO as a product catalog CMS
- Recalculate tax inside QBO and write it back onto `TaxCalculation`
- Post accounting records before mapping, duplicate protection and provider acceptance are complete
