# Original sales and refund accounting evidence

Read-only build increment. Reports → QuickBooks now provides a paid-order selector and separate views of the original sale, cash-refund settlements, compensations and reward-only entries. Review does not post receipts, send money or change tax evidence.

A sale must have a paid checkout in the current environment, a matching verified Stripe payment, exactly one finalization audit, original item snapshots, the saved Stripe tax calculation and matching destination/breakdown. Gross prices, promotion/reward discounts, net merchandise, tax and cash must reconcile to the original checkout and final paid tax lines. Reward spending additionally requires the consumed reservation and exact redemption ledger entry. Current catalog prices, current addresses and recalculated tax are not substituted for history. Shipping charges outside the current zero-shipping checkout model remain blocked pending an explicit shipping export model.

Refund entries retain their signed cash, net, tax and reward allocations. They must belong to the selected order and original payment/environment, match recorded request lines and have verified provider history for cash adjustments. Reward restoration/reversal must match its permanent ledger entry. A compensation must offset its recorded settlement and retain its failed-refund balance transaction. The original sale and settlement remain unchanged.

A cash settlement displays matched tax only when its saved RefundTaxEvidence binds the original provider account, environment, currency and exact tax amount. Allocated amounts alone remain UNVERIFIED. Compensation tax evidence remains UNVERIFIED; the current matched-report adapter does not prove a compensating tax reversal. Reward-only entries require NOT_APPLICABLE and do not need a cash receipt. No external acceptance is inferred from these statuses.

Finance reads use a read-only repeatable-read transaction. API access requires current finance authorization, including CPA read-only access; the customer storefront cannot access these records. The source retains its original US destination and a SHA-256 tax-snapshot fingerprint for subsequent immutable receipt preparation. Browser review displays amounts and evidence status without presenting raw provider payloads.

Validation uses isolated PostgreSQL records for exact source reconciliation, role isolation, read-only behavior, unmatched/matched tax receipts, signed compensations and missing evidence. Browser responses are explicitly synthetic on desktop/tablet/mobile. No new database migration is required.

Remaining: exact receipt payload preparation, clearing-account and tax-code configuration, protected SalesReceipt/RefundReceipt creation and receipt reconciliation, and real-company acceptance. The owner has deferred Stripe setup until the build is complete.
