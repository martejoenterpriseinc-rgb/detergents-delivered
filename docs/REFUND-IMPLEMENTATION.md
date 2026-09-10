# Refund and return implementation

Status: persistence foundation deployed at `70b1eda`; staff return receipts and unused-draft cancellation passed CI 99 at `5c732012922908c6b85c844f35050217a9953f59` (389 tests). Both web services were deployed and verified at that revision. The read-only provider adapter passed CI 100 and CI 101; consult LAUNCH-STATUS.md for the current rollout. Payment refund submission is not exposed.

The foundation adds exact cumulative cash reservations, serialized request-key replay, verified captured-payment binding, append-only request events, and separate immutable physical returns with original consumed cost allocation snapshots. Sellable returns restore the corresponding original cost layers; damaged returns consume their allocation position without restoring sellable inventory. Native tests exercise competing refund requests, duplicate returns, quantity limits, authorization, private DTO fields and immutable evidence.

Staff can receive inspected goods from the order detail page, with a condition per item, remaining quantities, receipt history and an explicit confirmation. Lost-response retries retain the same payload and request key. CPA access is read-only. Unsubmitted refund drafts can be canceled with an audited reason; submitted, uncertain and provider-bound requests cannot be canceled locally. Request status and allocated lines are visible without provider identifiers or private evidence.

The read-only adapter reads the original Stripe account, PaymentIntent, captured charge and all refunds through a bounded paginated list. It rejects wrong account/mode/currency/amount bindings, incomplete or duplicate history, unknown states and external/mismatched refunds. It selects minimal internal evidence and omits email, bank instructions and unrelated metadata. Nine mocked-provider tests cover these boundaries. This read-only adapter is not yet wired to a staff action, settlement ledger, webhook or worker, and does not establish real provider acceptance.

Refund allocation subtracts the actual surviving reserved net, tax and reward amounts before dividing the remaining quantities. This conserves all saved cents when an earlier partial draft is canceled while a later draft remains reserved. Quantity alone is insufficient to locate rounding remainders after cancellation.

Reward-funded orders are explicitly blocked at preparation until reward restoration and compensation are implemented. Provider submission/reconciliation, tax reversal evidence, reward/referral adjustments and the payment refund staff controls remain required before enabling refunds. Physical receipts do not move money or imply a payment refund.

The foundation release used `node --import tsx scripts/deploy-refund-foundation.ts` to check existing database identity and complete migration history, permit only the two named additive migrations, apply them and verify history again. Both web services now use the strictly read-only `npm run db:preflight` pre-deploy command. The staff controls add no migrations.

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
