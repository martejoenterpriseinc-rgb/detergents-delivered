# Durable refund submission boundary

This increment implements internal claim and provider submission primitives. They have no HTTP, worker, startup or UI caller. Refund submission remains unavailable until settlement, compensation, rewards, tax evidence and provider acceptance are complete. No real refund was submitted during development or validation.

`claimRefundSubmission` requires current order-management authority and an exact saved draft. It serializes against the order lock used by cancellation, verifies the saved request fingerprint, original payment and checkout identity, amount/currency, remaining item quantities/net/tax allocations and payment capacity. Reward-funded orders and unresolved previous submissions remain blocked.

Before any provider call, the claim atomically records SUBMITTING, the submission time, an append-only event and an audit entry. An audit failure rolls everything back. Concurrent attempts yield one claim. A previously submitted request cannot be claimed again, even after time passes or its state changes. Payment, inventory, reward and settled refund records remain unchanged by the claim.

`submitClaimedStripeRefund` consumes the private server-side envelope. The future orchestrator must obtain it from a newly committed claim, never a client payload. It checks original Stripe evidence and complete refund history before creating a refund against the saved PaymentIntent and amount. It blocks disputes, external or mismatched refunds, excessive amounts and unresolved prior operations. An exact existing provider refund is returned without another create request.

Creation uses a stable request-bound idempotency key, an eight-second timeout and zero SDK retries. The adapter rejects stale/future claims. Any timeout or unconfirmed outcome leaves the durable SUBMITTING reservation for reconciliation; it never resets the request to PREPARED or releases funds. The returned minimal provider observation is not itself a ledger settlement.

The orchestration and durable settlement/compensation stage must persist the returned receipt and reconcile uncertain outcomes before exposing refund controls. It must recheck authorization immediately before initiating a claim, keep provider I/O outside database transactions and never retry an old create after provider idempotency retention. Physical goods receipt remains independent of money movement.

Validation: mocked-provider tests cover original payment binding, exact existing-refund recovery, stale claims, disputes, excessive amounts, external refunds, unknown attempts, timeouts and mismatched responses. Native PostgreSQL tests cover concurrent claims, role restrictions, audit rollback, changed allocations, delayed retries, another unresolved request and cancellation races. These tests do not establish real Stripe acceptance.

References reviewed September 11, 2026: [Refund creation](https://docs.stripe.com/api/refunds/create) and [idempotent requests](https://docs.stripe.com/api/idempotent_requests).
