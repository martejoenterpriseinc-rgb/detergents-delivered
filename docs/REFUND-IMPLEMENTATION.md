# Refund and return implementation

Status: persistence foundation under CI in PR 28. No refund or return HTTP/UI action is exposed, and no provider refund can be submitted by this implementation.

The foundation adds exact cumulative cash reservations, serialized request-key replay, verified captured-payment binding, append-only request events, and separate immutable physical returns with original consumed cost allocation snapshots. Sellable returns restore the corresponding original cost layers; damaged returns consume their allocation position without restoring sellable inventory. Native tests exercise competing refund requests, duplicate returns, quantity limits, authorization, private DTO fields and immutable evidence.

Reward-funded orders are explicitly blocked at preparation until reward restoration and compensation are implemented. Provider submission/reconciliation, canceling unused prepared requests, tax reversal evidence, reward/referral adjustments and the staff interface remain required before enabling refunds. Additive migration deployment alone does not complete those capabilities.

For this release, `node --import tsx scripts/deploy-refund-foundation.ts` checks the existing database identity and complete migration history, permits only the two named additive refund migrations, applies them, and verifies history again. It refuses empty/untracked databases, checksum drift, unfinished migrations and unrelated pending changes. Restore the normal read-only pre-deploy command after this release.

## Existing evidence

Checkout writes immutable item totals/tax/discounts, a pinned Stripe account and mode, consumed FIFO allocations, verified payment events and reward redemption entries. The existing Refund table only describes a recorded refund. It has no pending/failed lifecycle or item allocations, so it cannot safely represent a refund request before the provider outcome is known.

## Required durable records

Add a refund request with actor, reason, request key and canonical payload hash, order/payment binding, account/mode, requested currency/amount, provider identifier, current status and recovery timestamps. Store item quantities and exact saved net/tax allocations separately. Append minimal verified provider events; retain all state transitions and audit evidence. A completed refund record must reference its request uniquely.

Use separate stock-return records with item/consumed cost allocation, quantity, condition, actor, reason and idempotency key. Returning funds does not establish that goods were received. Return stock only after an explicit physical-return action; use original FIFO cost and retain original sale allocations. Damaged returns must not become sellable stock.

## Payment state and recovery

Authorize against current staff roles, lock the order, and reserve refundable amounts/quantities against both settled and unresolved requests. Never permit concurrent requests to exceed the verified captured amount or purchased quantity. A reused key with a different payload is a conflict. Commit the request before calling Stripe, with a stable provider idempotency key. Never hold a database transaction across a network request.

Fetch the original payment from the pinned account and verify its metadata, mode, currency and captured amount before requesting a refund to that PaymentIntent. Recognize externally initiated refunds as a reconciliation issue instead of silently trusting local balances. Unknown network results retain the reservation. After provider idempotency retention could have elapsed, do not blindly retry creation: reconcile existing provider records and require attention if the result cannot be established.

Provider status is authoritative. Pending, requires_action, failed and canceled are distinct from succeeded. Reconciliation and verified webhook processing fetch fresh provider state rather than trusting delivery order. A refund can fail after initial success, so preserve compensating financial events rather than treating success as irrevocable. Do not reverse stock receipt because a payment refund later fails.

## Amount and reward invariants

Allocate from saved purchase amounts, never current prices or tax rates. Cumulative integer allocation must return every saved cent exactly once across successive partial quantities. Promotion discounts are not cash owed to the customer. Restore only redeemed reward credit attributable to successfully refunded merchandise; append reversals if the provider later reverses the refund. Keep referral eligibility and award reversals source-linked, idempotent and auditable. Negative reward balances must continue to block spending.

The current referral reviewer treats any Refund row as disqualifying and makes reversal terminal. Before adding provider refund failures/compensations, update that consumer to use verified net refund evidence; merely inserting failed or pending requests into Refund would incorrectly reverse awards. Preserve its existing wallet lock ordering and append-only ledger protections.

Do not infer historical tax jurisdictions or taxable bases from today's product/customer settings. Verify Stripe Tax reversal behavior for the actual Checkout integration, and store its evidence separately from the original tax snapshot.

## Acceptance before enabling

Native PostgreSQL tests must cover competing refunds, request-key replay/conflict, provider timeouts, out-of-order events, pending-to-success-to-failure, partial quantity rounding, externally initiated refunds, currency/account mismatches, role revocation, duplicate returns, damaged stock and reward overspend/reversal. Provider tests use injected adapters in isolated CI; production provider acceptance remains a separate controlled gate. Mobile UI must show amount, current status, reason, recoverable errors and explicit physical-return controls.

Provider references reviewed September 10, 2026: [refund lifecycle](https://docs.stripe.com/refunds), [create refund](https://docs.stripe.com/api/refunds/create), [Stripe Tax with Checkout](https://docs.stripe.com/tax/checkout).
