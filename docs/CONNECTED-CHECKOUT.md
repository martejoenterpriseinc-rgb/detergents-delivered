# Connected checkout build — September 9, 2026

This increment extends the existing app; the staging data is not production data. Checkout defaults closed. No real Stripe payment has been tested in this increment yet.

## Implementation

- Server-authoritative cart prices, sale selection, promotion terms, per-line integer discount allocation, destination tax and reward credit. Client amounts are rejected. Quotes expire in five minutes; price, address, rules and wallet are rechecked when reserving.
- Requires verified email, an approved customer and an owned reviewed address in exactly one active ZIP zone. Customers submit a new address for staff review; staff cannot change login roles or email verification through this action. Previous delivery snapshots remain fixed.
- Launch preorder checkout requires an enabled window and a reviewed, locked zone cadence with capacity. It reserves a provisional date internally and promises the saved window. This first checkout version closes after the launch cutoff; rolling recurring orders/subscriptions remain unimplemented.
- One transaction holds stock, FIFO cost quantities, promotional rewards and vehicle space. The same customer cannot open concurrent payment attempts. All other active holds and paid bookings consume vehicle capacity. Existing routes also count. Unknown case-pack loads and missing cost layers fail closed.
- Stripe SDK 22.6.1, API 2026-08-26.dahlia; Checkout Sessions with automatic tax, a fixed shipping snapshot, dynamic payment methods and deterministic request keys. Account identity, environment, charges capability, tax settings and a jurisdiction registration must match. The sandbox account read on September 9 had no active registrations; none were created.
- Rewards are currently modeled as seller-funded promotional merchandise discounts, capped at the post-promotion merchandise amount, not cash stored value. Tax is calculated after these discounts. **This policy needs business/tax review before activation.** Purchased gift cards, transferable balances and third-party-funded coupons are not supported.
- Provider-signed webhooks and authenticated reconciliation fetch the canonical Stripe Session. The browser return URL never finalizes a purchase. Duplicate events cannot duplicate sales, debits, routes or receipts. Unknown or changed payment totals keep holds and expose a staff review queue.
- Successful finalization writes payment evidence, sales ledger moves, consumed FIFO allocations, reward spending, immutable address snapshot, order lines with tax, route stop and audit evidence together. Zero-dollar Checkout Sessions record zero cash. Exact cost totals remain in allocations/audit; the existing unit COGS field is a rounded display average.
- Cancellation releases holds only after Stripe confirms expiry. Asynchronous payments retain holds. `scripts/reconcile-checkouts.ts` prepares a bounded, repeatable worker pass; it must be scheduled and monitored before activation.
- Customer payment status and reward-used/remaining notice; staff payments/recovery page; address approval queue. Provisional route date is withheld from the customer order card until confirmed.

## Review and test boundaries

Unit tests cover discount allocation, payload rejection and environment gates. Native integration tests cover competing buyers, capacity, idempotency, stale quote rejection, consent, FIFO consumption, duplicate settlement, zero-cash rewards, uncertain payments, expiry release, audit rollback, address ownership and staff permissions. Stripe calculation and session evidence in native tests are explicitly mocked; they are not provider sandbox acceptance. Browser tests cover address submission/approval, refresh persistence, customer/admin separation and the closed checkout/webhook guards. Hosted payment browser acceptance still needs actual provider credentials.

The additive migration creates CheckoutAttempt, CheckoutCostAllocation and CheckoutProviderEvent. Prior migrations and existing business records are not rewritten. Database constraints restrict resource states, positive cost allocations and foreign keys. Staging migration/deployment must follow a successful full CI run and current recovery/preservation checks.

## Activation requirements — do not skip

1. In the existing staging service, securely configure `STRIPE_RESTRICTED_KEY` (preferred), `STRIPE_WEBHOOK_SECRET` and `DD_STRIPE_ACCOUNT_ID`. Keys remain server-only. The selected testing target is the explicitly named DetergentsDelivered sandbox; no account-specific writes were performed.
2. Confirm sandbox tax settings, origin location, applicable active registrations and product tax codes. Sandbox setup does not establish live tax registration. Required API access: account read, customers create/read, Tax settings/registrations read, calculations create, Checkout Sessions create/read/expire; payment and refunds scopes must be included when those workflows are added.
3. Configure webhook events: checkout.session.completed, checkout.session.expired, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed. Add explicit refund events with the refund implementation before launch.
4. Accept real provider success, decline, timeout, duplicate/reordered events, asynchronous payment, cancellation/expiry, zero payment, stale quote, wallet reversal and delivery-capacity tests. Verify tax lines exactly match the accepted quote. Tax differences must enter review, never charge a second time automatically.
5. Complete refunds and reward restoration/reversal, automatic referral awards, worker deployment/recovery, customer verification email, durable private photo/catalog storage, delivery-date confirmation messages, stock return handling and operational reconciliation. These remain open; they are not made ready by adding a key.
6. Prepare a separate production database, storage, origin/auth secret, live Stripe resources and notification resources. Import only reviewed catalog/configuration; never staging customers/orders/rewards/tickets/provider events. Perform a restore exercise and reconcile a controlled live acceptance order before public activation.

`DD_CHECKOUT_ENABLED=true` is an operations-controlled server setting, not a public/admin form. Production additionally requires `DD_LIVE_CHECKOUT_ACCEPTED=true`; neither is an acceptance test or a substitute for the requirements above. Leave both off until the complete workflow passes. No domain/DNS or live launch is performed by this increment.

Documentation: https://docs.stripe.com/api/checkout/sessions/create · https://docs.stripe.com/tax/standalone-tax-api · https://docs.stripe.com/tax/checkout

## Review corrections

- Checkout snapshot comparisons canonicalize object keys because PostgreSQL JSONB changes key order. Values and array order remain significant, and stale-price rejection remains enforced.
- Delayed successful payments retain holds for staff review when their provisional date has passed or the vehicle's route has started. They cannot append an unplanned stop to an active route.
- A targeted override pins Prisma's config-only `deepmerge-ts` dependency to 8.0.0 for GHSA-ggr8-5vv4-36mx. The upstream change affects Map merging; this project does not use Map-based Prisma config. Migration generation/replay and build checks are required with this override. Advisory: https://github.com/advisories/GHSA-ggr8-5vv4-36mx
