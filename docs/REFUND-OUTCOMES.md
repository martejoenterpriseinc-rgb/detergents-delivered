# Refund submission outcomes

The internal `submitPreparedRefund` workflow now connects the durable claim to the Stripe adapter and records its result. There is no HTTP, worker, startup or UI entry point. Payment refund controls remain unavailable until settlement, compensation, rewards, tax handling and provider acceptance are complete.

The claim commits before provider I/O. Only its winning caller can submit. The caller rechecks staff access, sends the saved internal envelope and records a minimal validated observation. A provider exception becomes an unconfirmed outcome without saving raw errors or retrying creation. A database failure after a response leaves the existing claim reserved for recovery.

`recordRefundSubmissionResult` locks the order, rechecks current management authority, verifies submitted state and exact request/hash/amount/currency/provider binding, and atomically writes the provider reference, append-only evidence and audit. Receipt snapshots are deduplicated under concurrent retries. Only the server adapter's minimal fields are accepted; raw provider payloads and bank/email instructions are rejected. Responses expose the existing private-safe refund request DTO.

All outcomes remain UNKNOWN and reserved until settlement reconciliation. A provider status of succeeded is recorded as evidence, not a completed financial refund. Failed/canceled observations likewise cannot release reservations before compensation is evaluated. Separate observations preserve success and later failure evidence. These snapshots are not a provider event-order authority; settlement must fetch current provider state and handle its own versioned ledger transitions.

A repeated timeout is recorded once. A delayed timeout cannot clear an already recorded provider reference or receipt. Conflicting provider identifiers are rejected. This function cannot downgrade a request that has already left the submission-review states. No Payment, Refund, stock, reward or tax record is changed.

Tests use native isolated PostgreSQL with synthetic provider observations. They cover concurrent orchestration, committed claim before provider I/O, timeouts with no retry/raw error leakage, duplicate receipts, delayed timeout, success/failure evidence, role and binding restrictions, terminal-state protection and atomic audit rollback. No real provider refund is issued by these tests.
