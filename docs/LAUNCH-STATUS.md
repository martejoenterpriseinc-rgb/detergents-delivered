# Launch status — September 10, 2026

Public launch is not complete. Checkout remains disabled in sandbox and isolated production.

## Verified release

Both DD web services run `70b1edafab922aa99a3f13cf9b774eef34654540`, including Finance, Orders and the refund/return persistence foundation. CI 96, run 34480937520, passed lint, typecheck, schema validation, migration replay, build, 241 unit tests, 101 native PostgreSQL tests and 37 browser tests (379 total).

Sandbox deploy `dep-dahas26k1f9s73ebaeog` and production deploy `dep-dahatuqjnfac73928kmg` were verified live. Both returned readiness 200, anonymous Orders/Finance 401 and checkout disabled. Existing records were preserved. Both now use the strictly read-only `npm run db:preflight` pre-deploy command; auto-deploy remains off.

## Active build

PR 28 adds staff physical-return receipts, condition per item, status/history, lost-response retry protection and audited cancellation of never-submitted refund drafts. CPA access remains read-only. Revision `5c732012922908c6b85c844f35050217a9953f59` passed CI 99, run 34487556692: 246 unit, 103 native PostgreSQL and 40 browser tests (389 total), plus lint, typecheck, schema/migration validation and build. Desktop, tablet and mobile screenshots were reviewed. Sandbox deploy `dep-dahbqh1594qs7381v7sg` is in progress; production remains at the verified foundation above until its rollout is confirmed. It also fixes partial-refund rounding after an earlier draft is canceled. Provider refund submission remains unavailable.

The next read-only Stripe adapter verifies original payment binding and detects external or duplicate refunds. Its nine mocked-provider tests pass locally. It is not yet connected to the settlement ledger, staff actions, webhooks or workers; the payment refund workflow remains unfinished.

## Observed production setup blockers

A read-only September 10 check found zero production users, products, business setup records, delivery zones and orders. The API editor can save securely, but all production provider groups are unconfigured: Stripe, Google, email, SMS, QuickBooks and storage. Configuration presence alone will not establish provider acceptance. There is no production owner account to use the editor yet; first-owner onboarding must verify ownership without copying staging credentials or automatically promoting an unverified customer.

## Remaining launch workstreams

1. Finish Orders operations: refunds, physical returns, reward restoration/reversal and corresponding reconciliation/acceptance.
2. Replace CPA/tax/import-export placeholders with source-backed reports and safe imports; implement idempotent QuickBooks posting and reconciliation.
3. Complete quarterly-only subscriptions, consent, schedule generation, pause/skip/cancel, price changes and failed-payment handling. The legacy 28-day model is not the approved business rule.
4. Complete the protocol-neutral agent commerce gateway with scoped authentication and consent, using the same business services.
5. Connect and verify intended payment/tax, email, OAuth, storage and notification providers; complete worker monitoring/recovery. Mock adapter tests are not provider acceptance.
6. Finish production owner/business setup, reviewed catalog and stock, delivery capacity, approved domain, recovery rehearsal and controlled end-to-end acceptance before enabling checkout.

The existing catalog/receiving, customer access, checkout backend, delivery operations, website builder and line-by-line integration settings are the foundation. An implemented screen is not proof that all external dependencies or public-launch requirements are satisfied. Consult GO-LIVE-BUILD-CONTRACT.md for the full acceptance scope; its historical checkpoint is not the current deployment revision.
