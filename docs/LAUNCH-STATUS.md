# Launch status — September 10, 2026

Public launch is not complete. Checkout remains disabled in sandbox and isolated production.

## Verified release

Finance and the mobile record layout are deployed to both DD web services at `202a194d23e530f849817a89a0022a6a24bc012c`. CI run 34464189952 passed 231 unit, 95 native database and 34 browser tests, plus lint, typecheck, migration replay and build. Hosted readiness returned 200; finance APIs rejected anonymous access. Existing record counts were preserved. Production has no users or published catalog yet.

## Active build

The Orders workspace replaces its placeholder with search, filters, pages and historical detail. PR 27, revision `ab1cb65ff371bc8af06552da659b81e1019fd0d6`, is undergoing CI and device review. It must not be described as deployed until exact-revision release verification is recorded.

Refund preparation is on `feature/go-live-refunds`: cumulative monetary allocation and capacity validation have unit coverage; the durable provider lifecycle, physical returns and reward integration remain to implement. These helpers do not expose a refund action.

## Remaining launch workstreams

1. Finish Orders operations: refunds, physical returns, reward restoration/reversal and corresponding reconciliation/acceptance.
2. Replace CPA/tax/import-export placeholders with source-backed reports and safe imports; implement idempotent QuickBooks posting and reconciliation.
3. Complete quarterly-only subscriptions, consent, schedule generation, pause/skip/cancel, price changes and failed-payment handling. The legacy 28-day model is not the approved business rule.
4. Complete the protocol-neutral agent commerce gateway with scoped authentication and consent, using the same business services.
5. Connect and verify intended payment/tax, email, OAuth, storage and notification providers; complete worker monitoring/recovery. Mock adapter tests are not provider acceptance.
6. Finish production owner/business setup, reviewed catalog and stock, delivery capacity, approved domain, recovery rehearsal and controlled end-to-end acceptance before enabling checkout.

The existing catalog/receiving, customer access, checkout backend, delivery operations, website builder and line-by-line integration settings are the foundation. An implemented screen is not proof that all external dependencies or public-launch requirements are satisfied. Consult GO-LIVE-BUILD-CONTRACT.md for the full acceptance scope; its historical checkpoint is not the current deployment revision.
