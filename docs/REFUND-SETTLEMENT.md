# Refund settlement and signed adjustments

`reconcileRefundSettlement` is an internal, read-only-provider reconciliation boundary. It fetches current Stripe refund history, verifies the original account, mode, payment, amount and request metadata, then rechecks authority and the local snapshot under wallet/referral/order locks. It never creates a provider refund and has no HTTP, worker, startup or UI caller.

A verified success atomically appends the original Refund, an immutable SETTLEMENT adjustment, restored redeemed credit, referral changes, request evidence and audit. Cash equals saved net merchandise plus saved tax. Payment totals use effective refunds. Inventory receipts and fulfillment history remain independent.

A later failure or cancellation of a succeeded refund requires an independently retrieved positive Stripe failure balance transaction with matching refund source, currency and amount. The transaction appends a negative COMPENSATION adjustment, reverses restored credit, recomputes payment totals and restores previously reversed referral awards only when no effective qualifying refund remains. It preserves the original Refund and adjustment. Negative reward balances continue to block redemption. Replays do not append money twice, conflicting terminal transitions fail closed, and audit failure rolls back the entire financial change.

Mixed reward/promotion purchases restore only the originally redeemed reward amount. The allocation uses original snapshot line order and the saved combined discount weights, including deterministic integer remainders. It validates the USED reservation, redemption ledger entry and saved item quantities/amounts; current prices or tax rates are never used. Zero-cash, reward-only refunds are not supported by this increment and remain blocked.

## Tax review

The Taxes page is now a read-only report for ADMIN, SUPER_ADMIN and CPA. It shows verified-paid-order tax snapshots and signed refund tax allocations using Chicago business dates. Untrusted paid-order records are excluded and counted. Date ranges and source size are bounded, and results are paginated. It is not a tax filing or amount-due calculation.

Every refund adjustment is explicitly UNVERIFIED for provider tax matching. No provider tax reversal is created or inferred. Automatic Checkout tax reversal evidence, registrations, compensation behavior and provider matching must be established against the intended Stripe account before enabling refund controls. The immutable adjustment is local accounting evidence; later provider evidence requires a separate append-only record, not editing this row.

## Validation and remaining activation gates

Native PostgreSQL tests cover mixed-credit partial settlement, pending states, duplicate and concurrent reconciliation, later failure compensation, returned-funds rejection, stale terminal events, referral reversal/restoration, authorization, snapshot conflicts, immutable adjustments and audit rollback. Tax checks cover CPA review of sale/settlement/compensation entries and customer denial. Browser acceptance covers the Taxes report at the configured viewport sizes. Provider responses in these tests are synthetic, not real acceptance.

The September 11 configuration read found staging and production checkout disabled. Both lacked their Stripe server key, account identity and webhook secret; production also lacked its checkout acceptance acknowledgement. The connected Stripe account-details tool failed with `Unknown tool: get_stripe_account_info`. No live refund, tax transaction, credential change, migration or deployment was performed by this increment.

Activation still requires real Stripe/tax acceptance, zero-cash reward handling, guarded operational callers, reconciliation scheduling, and the separately reviewed additive migration `20260916100000_refund_accounting`. The existing refund-foundation deployment command is not authorization to apply this new migration. Public Go Live remains blocked by the broader launch contract as well.
