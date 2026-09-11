# Launch status — September 11, 2026

Public launch is not complete. Checkout remains disabled in sandbox and isolated production.

## Owner-directed build continuation

Stripe setup is deferred until application construction is complete. Continue independent implementation without repeatedly requesting provider setup. The reward-only return increment adds staff preparation, explicit credit confirmation, idempotent restoration and responsive browser acceptance; see REWARD-ONLY-REFUNDS.md. It does not activate cash refunds or public checkout.

Quarterly consent and lifecycle controls are implemented in PR 39; the dependent cycle increment now connects scheduled review to authoritative checkout and payment-linked advancement, pending its full CI acceptance. Ongoing delivery booking adds an opt-in lead time and horizon to the existing checkout and capacity services; see ONGOING-DELIVERY-BOOKING.md. Neither change enables checkout or substitutes for provider acceptance.

## Current build and provider checkpoint

The deployed release subsequently advanced to `a2495c4afa459a9c258804841fa37b038ecdd828` (PR 33). The release evidence below describes an earlier deployment, not the current revision. PRs 34–36 add internal submission, outcome recording and lost-response recovery; PR 36 passed CI 112 with 454 tests. Those increments have no public refund submission caller.

The next increment adds atomic signed refund settlement/compensation, redeemed-credit and referral adjustments, and a read-only Taxes report. See REFUND-SETTLEMENT.md for exact behavior and unfinished activation gates. Its new migration has not been applied to either hosted database.

A September 11 read of each hosted app's effective commerce configuration confirmed checkout disabled and Stripe server key, account identity and webhook secret missing in both environments. Production acceptance acknowledgement is also missing. No real provider acceptance or Go Live status is claimed.

## Earlier verified release

Revision `c23118f26c52c7f313453c1e546f9df4536a05f3` passed CI 101, run 34490225118: lint, typecheck, schema validation, migration replay, build, 255 unit tests, 108 native PostgreSQL tests and 40 browser tests (403 total). It includes the staff return controls, read-only Stripe refund inspection and explicit first production owner command.

Sandbox deploy `dep-dahc5oe7bikc73fanbq0` and production deploy `dep-dahc7n6q1p3s73ebhco0` were verified live at that revision at 14:49:54 UTC and 14:54:12 UTC respectively. Both returned readiness 200 and anonymous Orders/Finance and order mutation responses of 401. Checkout remained disabled and record counts were preserved: sandbox has two users; production has zero users; both have zero products, orders, refund requests, refunds and stock returns. Error-level logs were clear through 14:54:33 UTC. These checks establish this release’s health, not provider or public-launch acceptance. Both services use the strictly read-only `npm run db:preflight` pre-deploy command; auto-deploy remains off.

## Completed build increments

PR 28 adds staff physical-return receipts, condition per item, status/history, lost-response retry protection and audited cancellation of never-submitted refund drafts. CPA access remains read-only. Staff controls at `5c732012922908c6b85c844f35050217a9953f59` passed CI 99 (389 tests) and were deployed and verified on both services. Desktop, tablet and mobile screenshots were reviewed. The change also fixes partial-refund rounding after an earlier draft is canceled. Provider refund submission remains unavailable.

The read-only Stripe adapter verifies original payment binding and detects external or duplicate refunds. Its nine mocked-provider tests passed in CI 100 (398 total tests) and CI 101. It is not yet connected to the settlement ledger, staff actions, webhooks or workers; the payment refund workflow remains unfinished.

PR 29 adds an explicit hosting-operator command for the first production owner. It defaults to read-only review, requires an existing verified account and exact authorization, checks retained production identity, and atomically grants the role with an audit and session revocation. Five native tests cover replay, concurrency, identity checks, previous staff, revoked authority and audit rollback. No owner grant has been executed on either hosted service. See PRODUCTION-OWNER.md for the operator workflow.

## Observed production setup blockers

A read-only September 10 check found zero production users, products, business setup records, delivery zones and orders. The API editor can save securely, but all production provider groups are unconfigured: Stripe, Google, email, SMS, QuickBooks and storage. Configuration presence alone will not establish provider acceptance. There is no production owner account to use the editor yet; first-owner onboarding must verify ownership without copying staging credentials or automatically promoting an unverified customer.

## Remaining launch workstreams

Reward-only returns passed CI 118 with 471 tests. Quarterly lifecycle controls passed CI 119 with 484 tests. Both include native PostgreSQL and desktop/tablet/mobile acceptance; screenshots were inspected. Neither has been deployed to hosted databases.

1. Finish Orders operations: refunds, physical returns, reward restoration/reversal and corresponding reconciliation/acceptance.
2. Replace CPA/tax/import-export placeholders with source-backed reports and safe imports; implement idempotent QuickBooks posting and reconciliation.
3. Complete quarterly-only subscriptions, consent, schedule generation, pause/skip/cancel, price changes and failed-payment handling. The legacy 28-day model is not the approved business rule.
4. Complete the protocol-neutral agent commerce gateway with scoped authentication and consent, using the same business services.
5. Connect and verify intended payment/tax, email, OAuth, storage and notification providers; complete worker monitoring/recovery. Mock adapter tests are not provider acceptance.
6. Finish production owner/business setup, reviewed catalog and stock, delivery capacity, approved domain, recovery rehearsal and controlled end-to-end acceptance before enabling checkout.

The existing catalog/receiving, customer access, checkout backend, delivery operations, website builder and line-by-line integration settings are the foundation. An implemented screen is not proof that all external dependencies or public-launch requirements are satisfied. Consult GO-LIVE-BUILD-CONTRACT.md for the full acceptance scope; its historical checkpoint is not the current deployment revision.
