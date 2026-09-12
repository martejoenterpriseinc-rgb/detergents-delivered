# Tip refund and driver-transfer accounting

Reports → Delivery tips → Refund and payout accounting inspects the original dedicated Stripe tip payment and its complete bounded refund history. Merchandise payment metadata cannot stand in for tip evidence. The existing verified receipt audit, original tip source and pinned driver are required. Intended account, environment, captured amount and currency are checked before displaying payable amounts or accepting a new transfer record.

Driver entitlement excludes collected tax. Successful full refunds remove the full tip entitlement; if that tip was already paid out, the amount becomes recoverable from the driver. Pending refunds, disputes, missing debit evidence and partial refunds without a verified tip/tax split block additional payments. Failed refund debits require matching provider failure-balance evidence before restoring payable capacity. Cash refund observations do not establish accepted provider tax corrections.

Admins record an already completed transfer with amount, date, unique per-tip receipt reference, reason and explicit receipt confirmation. This does not initiate bank transfers. CPA access is read-only. Separate exact-amount reversal entries document funds returned or a failed transfer; the original record is preserved. Reversals do not silently issue another driver payment. The service checks source, access and payout capacity under a tip row lock; duplicate requests reuse one result, changed request payloads conflict and audit failure rolls back the transfer entry. Original orders, rewards, tax, stock and tip receipts are unchanged.

The additive `20260917010000_tip_payout_accounting` migration adds only `TipPayoutEntry` with foreign keys, positive amount constraints, reversal constraints and duplicate-reference protections. It is not applied to hosted databases in this increment. All earlier migration SQL remains unchanged.

Validation added: domain tests for tax exclusion, refunds after payout, pending/partial refund holds, returned balances, exact reversal and duplicate evidence; provider tests isolate dedicated tip metadata; native tests cover authorization, duplicate concurrency, excess/reused requests, retained originals, refunds after payout, reversals and audit rollback. Native/production acceptance must be recorded from their actual runs.

Remaining tip work: initiation and recovery of app-requested refunds, partial tip/tax allocation backed by provider evidence, QuickBooks liability/refund/payout posting, scheduled tip refund monitoring, native/browser acceptance and real provider acceptance. No API credentials were connected and no real transfer or refund was initiated.

## Matched partial tip/tax allocations

The tip accounting screen now accepts a completed refund, completed Stripe itemized tax
report run ID and refunded tax amount for verification. The existing bounded report API
reader binds the original Checkout session, payment intent, refund ID, currency, original
cash/tax totals and reversal totals. Staff-entered amounts alone cannot create evidence.

An immutable, deterministically keyed audit receipt records the report/file/hash, original
and refund tax transaction IDs, intended account/environment and exact cash/tax allocation.
Concurrent/repeated matching preserves one record. A changed tax transaction or allocation
conflicts. Original payment, order, tax, rewards and payout entries remain unchanged.

Partial refunds with complete matched allocations reduce driver entitlement by refunded
cash minus refunded tax. Already-paid entitlement becomes recoverable. Pending refunds,
disputes, missing debit evidence or incomplete allocations continue to block new payments.
Failed refunds do not consume a prior allocation; existing returned-balance verification
still applies. Cumulative allocations cannot exceed original tip or tax amounts.

This reads existing provider evidence. It does not initiate a refund, submit a tax correction,
or post a QuickBooks entry. Those workflows and live provider acceptance remain open.

## Tip refund initiation and recovery

Admins can submit a full or partial cash refund against the original dedicated tip payment.
`DD_TIP_REFUNDS_ENABLED` gates submission; live additionally requires
`DD_LIVE_TIP_REFUNDS_ACCEPTED`. Both remain off for activation/acceptance. Recovery remains
available for already-committed requests even if new submission is disabled.

The additive `20260917030000_tip_refund_requests` migration creates a durable request ledger.
The original verified tip/account/environment is bound to the request. The request and its
permanent claim audit commit under the tip lock before the one provider create invocation.
A stable request key/hash provides replay protection. Repeated requests never trigger a
second POST. Network or provider uncertainty retains UNKNOWN capacity. Recovery looks up
the complete bounded provider history and requires exact request metadata, amount, currency,
original payment, and claim audit; it never re-submits a create request.

A received POST response is not treated as settled money: a fresh provider lookup confirms
state. Successful refunds require debit evidence; failed debits require returned-balance
verification before capacity reopens. Unknown/pending local requests and disappearing or
changed provider evidence block new payouts. Refunds after completed driver transfers create
recoverable entitlement through the existing accounting view; partial tip/tax matching remains
necessary. Original orders, rewards, receipts and driver transfers are not rewritten.

The payment recovery worker includes bounded tip-refund lookups with lease checks. Staff can
also check a request from the tip screen. An unknown request absent from provider history is
retained for investigation, never assumed safe to cancel or send again.

Validation added: provider binding/idempotency/stale-claim tests; native concurrent submission,
unknown-result recovery without another POST, access/activation/remaining-cash guards,
original-record preservation and audit rollback. Dedicated live provider acceptance, tip refund
webhook routing, reviewed resolution of never-created UNKNOWN claims, QuickBooks tip postings
and production migration/release remain open. No live refund has been sent in this build.
