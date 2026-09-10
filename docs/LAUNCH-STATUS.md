# Launch status — September 10, 2026

Public launch is not complete. Checkout remains disabled in sandbox and isolated production.

## Verified release

Finance and the mobile record layout are deployed to both DD web services at `202a194d23e530f849817a89a0022a6a24bc012c`. CI run 34464189952 passed 231 unit, 95 native database and 34 browser tests, plus lint, typecheck, migration replay and build. Hosted readiness returned 200; finance APIs rejected anonymous access. Existing record counts were preserved. Production has no users or published catalog yet.

## Active build

The Orders workspace replaces its placeholder with search, filters, pages and historical detail. PR 27, revision `e13a48dba5aae3a80b6e99dac26c5de07c03287e`, passed CI run 34467118370: 234 unit, 99 native database and 37 browser tests (370 total), lint, typecheck, migration replay and build. List/detail screenshots were reviewed at desktop, tablet and mobile widths. It is deployed to both DD web services: sandbox deploy `dep-dah8ljn40ujc73e3gg2g` and production deploy `dep-dah8lpp42hec73f98ic0`. Both report readiness 200, anonymous Orders/Finance access 401 and checkout disabled. The authenticated sandbox Orders page works. Record counts are unchanged; the post-release error log query was empty. This is the current web revision, superseding the finance-only revision above.

Refund preparation is on `feature/go-live-refunds`: cumulative monetary allocation and capacity validation have unit coverage; the durable provider lifecycle, physical returns and reward integration remain to implement. These helpers do not expose a refund action.

## Remaining launch workstreams

1. Finish Orders operations: refunds, physical returns, reward restoration/reversal and corresponding reconciliation/acceptance.
2. Replace CPA/tax/import-export placeholders with source-backed reports and safe imports; implement idempotent QuickBooks posting and reconciliation.
3. Complete quarterly-only subscriptions, consent, schedule generation, pause/skip/cancel, price changes and failed-payment handling. The legacy 28-day model is not the approved business rule.
4. Complete the protocol-neutral agent commerce gateway with scoped authentication and consent, using the same business services.
5. Connect and verify intended payment/tax, email, OAuth, storage and notification providers; complete worker monitoring/recovery. Mock adapter tests are not provider acceptance.
6. Finish production owner/business setup, reviewed catalog and stock, delivery capacity, approved domain, recovery rehearsal and controlled end-to-end acceptance before enabling checkout.

The existing catalog/receiving, customer access, checkout backend, delivery operations, website builder and line-by-line integration settings are the foundation. An implemented screen is not proof that all external dependencies or public-launch requirements are satisfied. Consult GO-LIVE-BUILD-CONTRACT.md for the full acceptance scope; its historical checkpoint is not the current deployment revision.
