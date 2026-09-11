# Quarterly subscription controls

Owner scope: every three calendar months, with payment at purchase. A saved schedule never authorizes automatic charges, reserves stock or promises a delivery date. Stripe setup is deferred to final provider activation while this build continues.

Households can enroll products from an owned, verified paid order after email verification and purchase approval. Enrollment records the exact consent version and text, original order/items, a calendar anchor and the next quarterly review date. Pause, resume, skip and cancel are functional server-side actions. Each change rechecks identity/ownership, serializes on the household and subscription, rejects stale versions and records an immutable event and audit atomically. Request-key retries are safe; changing a payload with the same key is a conflict. Cancellation does not mutate historical orders, payments or deliveries.

Calendar dates use three-month increments from the original anchor, not 28 or 90 days. Month-end clamping is calculated from that original anchor each time, preserving January 31 → April 30 → July 31. Resume advances past missed quarters without catch-up purchases or charges.

The additive migration preserves existing schedules. Older 28-day rows are not converted or treated as consented quarterly subscriptions; they can be paused or canceled but cannot be resumed under a different cadence. New quarterly rows require matching consent, an anchor and no day-based cadence.

The account page replaces disabled placeholder controls with consent, saved subscription products/dates and actionable controls. The API is household-scoped, checks origin/body limits and rejects cadence or financial overrides. Native tests cover household isolation, eligibility, concurrency, retries, immutable evidence, stale versions, rollback and legacy behavior. Browser tests cover consent, lost-response retry and all lifecycle controls across desktop/tablet/mobile.

This increment implements enrollment and schedule management. Due-cycle order generation, connection to authoritative checkout, payment outcome reconciliation and rolling delivery booking are the next dependent implementation work. No provider payment is created by these controls. No hosted migration or deployment has occurred for this increment.
