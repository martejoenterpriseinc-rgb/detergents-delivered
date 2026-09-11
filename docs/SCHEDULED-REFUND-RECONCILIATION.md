# Scheduled refund reconciliation

The worker checks at most ten submitted cash refunds per pass. It only reads provider state; it never creates a refund. Account and mode filters exclude other provider bindings. A durable last-check timestamp rotates failures out of the front of the queue. Pending or uncertain outcomes are checked at most once per minute; successful refunds are checked daily for later failure and verified compensation. Failed/canceled terminal refunds and unsubmitted drafts are excluded.

Every unit renews the existing environment-specific worker lease. Provider lookup failures retain quantities and accounting reservations. Existing immutable settlement, returned-funds evidence, reward restoration/reversal, referral adjustment, wallet/order locks and audit rollback rules still apply. Tax allocations remain unverified until separate provider tax evidence is matched.

Scheduled work uses a server-only capability instead of impersonating a staff user. Settlement audit records have no human actor and identify scheduled reconciliation. Staff endpoints still require authenticated order management permission. No browser or JSON payload can select the capability.

Migration 20260916140000_refund_recovery_schedule adds only a nullable scheduling timestamp and index. It has not been applied to hosted databases. Stripe activation and real provider acceptance remain deferred. Mocked provider tests are implementation evidence only.
