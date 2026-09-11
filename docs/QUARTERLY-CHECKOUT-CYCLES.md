# Quarterly review and checkout cycles

A due subscription creates one immutable review snapshot for its saved quarter. A unique subscription/quarter key and the household lock serialize browser retries and scheduled preparation. The existing leased operational worker prepares bounded batches of up to 100 missing cycles; repeated runs do not create catch-up purchases. No provider, order, inventory reservation or charge is created by preparation. Paused, canceled, legacy and not-yet-due subscriptions are excluded.

The household opens the quarter in Account → Subscriptions, reviews current pricing, promotions, rewards, destination tax and delivery availability through the existing checkout, and explicitly accepts payment and the delivery window. The saved cycle binds the household, address, products and quantities. Client-controlled quarter numbers or prices are rejected. Ordering stays closed when its real dependencies are absent.

A cycle can have only one unresolved checkout. Attachment is rechecked after tax-provider I/O under the household lock. A canceled or expired unreserved quote permits another review. Provider-owned pending or uncertain sessions keep their holds and block replacement. The same checkout recovery worker handles payment outcomes; no second payment implementation was introduced.

Verified settlement marks the cycle paid and advances the anchored schedule to the next future quarter exactly once, in the same transaction as the order, inventory, payment, reward and audit records. It never bills missed quarters. Failed audit persistence rolls back all those changes. Zero-cash checkout continues through the existing verified no-payment-required path.

Pause and cancellation stop future purchases while allowing an already-started payment to reconcile. Skip and resume reject unresolved payment sessions. Unreserved quotes are expired and their open cycle is skipped/canceled when lifecycle controls resolve it. A completed payment does not reactivate a canceled subscription; a paused schedule remains paused. Quote cancellation now takes the checkout/household lock to avoid racing reservation.

Cycle snapshots, identity, date and completed outcomes cannot be rewritten or deleted. Customer endpoints remain authenticated, same-origin, size-limited and private/no-store. Operational health reports quarterly worker heartbeats and attention counts. Malformed schedules are reported for review; provider failures are handled by the existing payment-recovery process.

The additive migration and worker changes require the normal exact-revision rollout and recovery checkpoint. No hosted migration, provider request, external notification or checkout activation is part of this build increment. Native tests use mocked tax/payment evidence and cannot establish real provider acceptance.
