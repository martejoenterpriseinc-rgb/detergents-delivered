# Connected checkout acceptance — September 9, 2026

## Source and scope

PR #16 adds Checkout Sessions integration code, stock/FIFO/reward/vehicle reservations, verified payment reconciliation, customer delivery-address submissions and staff approval/recovery pages. This is a staging increment toward launch, not a production launch or a claim of successful Stripe sandbox payments.

- Repository: `martejoenterpriseinc-rgb/detergents-delivered`.
- Reviewed application: `f261baf297d2e816dbe2a30d216b5edf7deabb96`; equivalent local revision `59ddce1576f20f8b33b7f96eda14319834af97d6`, tree `bbb08a1b4fc723848c0cfa3d4929e71d3667e2c8`.
- Prior staging application: `403ce290f47e1959a56f9def1825e693b68f8dbc`.
- One additive migration, `20260910100000_connected_checkout`; SHA-256 `f540c719a77221df10a8a120639a826bb4afba13b1ea22eead1b2597baba184c`. Creates three checkout tables. All eight historical migration files match the completed staging checksums.

## Test evidence

Local lint/type checking and 144 unit checks passed. The dependency audit reports zero production dependency vulnerabilities after the targeted config-dependency override. CI52 passed all 49 native PostgreSQL tests, migration application/replay and production build. Its new address/recovery workflow passed on desktop and mobile. Two existing delivery tests exposed unclosed routes left by the new native fixtures; cleanup now cancels only those synthetic fixture routes. CI53 passed the final full-run gate for the reviewed revision: 144 unit tests, 49 native PostgreSQL tests and all 12 desktop/mobile browser workflows, plus lint, type checking, build and migration replay.

Run: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34365223088

Artifact: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34365223088/artifacts/10109741996 ; 131,139,355 bytes; SHA-256 `96cbbc9de5bba3aba17f7dfcbb4f898504e4abaaeed79363b92f34ebc9f32ea2`; GitHub retention 14 days.

Earlier CI failures led to real fixes: JSONB key ordering in stale-quote comparisons, selecting capacity fields for the strict vehicle validator and preserving pre-credit amounts in reward reservations. The stale-value, capacity, reward and rollback assertions were retained. No live database was used for CI, and Stripe responses in native tests are explicitly simulated.

Visual inspection of CI52 screenshots confirms the address approval state and payment recovery cards fit desktop/mobile layouts. The screenshot banner identifies synthetic records; these are not live purchases.

## Staging preparation

The existing service is `srv-daffhfqd0e5s73c76v2g`, with its pinned private database `dpg-daffb9fqj5pc73f52560-a` / `detergents_delivered_staging_db`. Auto-deploy remains off, start is `npm start`, pre-deploy is `npm run db:preflight`, and health path is `/api/ready`.

- A new recovery export completed at approximately 14:28 UTC; Render displays seven-day point-in-time recovery. No restore exercise has been performed.
- Read-only baseline and immediate pre-migration checks cover 57 application tables and 44 rows. Per-table row hashes are held privately in the staging instance, not published. Eight migrations are complete before this increment.
- Source and migration dependencies are prepared in an isolated temporary checkout. A full development-tool installation was interrupted on the small staging instance; the minimal production dependency installation and runtime check subsequently completed. The running source was not replaced by this preparation.
- Launch draft is October 15, 2026, disabled. The baseline covers the saved settings and audit record.

## Observed external blockers

Staging has no Stripe server key, webhook signing secret, account pin, SendGrid key or S3/R2 bucket configuration. The explicitly named DetergentsDelivered Stripe sandbox has no active tax registrations. No account-specific Stripe writes, real provider payment tests, DNS changes or production provisioning occurred.

There are zero published products, one active vehicle, one active delivery zone and zero email-verified customer accounts in staging. Business catalog/stock/tax codes, email verification and reviewed booking configuration are required before purchase testing. Do not substitute synthetic fixtures for these business inputs.

See CONNECTED-CHECKOUT.md for the remaining refund/reward reversal, automated referral award, worker, email, durable storage, delivery confirmation and production isolation work. Production needs fresh resources and controlled provider acceptance; the staging database must not become production.

## Final rollout result

The reviewed checkout migration applied successfully on staging before deployment. The new schema preflight reports 61 tables, nine completed migrations, no pending migrations and no problems. The post-migration preservation check confirms all 44 original rows across 57 application tables are unchanged. No CI fixtures were loaded into staging.

Exact-source deployment `dep-dagn36942hec73d2csg0` started at 14:47:53 UTC with `f261baf297d2e816dbe2a30d216b5edf7deabb96`. The deployment became live at 14:50:51 UTC. The new instance reports the exact reviewed Git HEAD. Both pre-deploy and startup database checks pass with nine completed migrations. The prior standalone/start warning is absent.

Hosted verification:

- `/api/health`, `/api/ready` and `/sign-in` return 200.
- Unauthenticated `/api/vendors`, owned-checkout GET and admin commerce POST return 401; an unsigned Stripe webhook POST returns 400. An initial request to the nonexistent `/api/admin/vendors` returned 404 and was replaced by the actual vendor route check.
- Existing owner session opens `/admin/payments`: checkout closed, all three new dashboard counts zero, no attempts. View as customer opens the household account and its new address form; Back to admin returns successfully. No customer/address changes were saved during this inspection.
- The hosted launch page and a read-only database query both show `2026-10-15`, version 1. Launch ordering and checkout activation remain false. CheckoutAttempt and CheckoutProviderEvent tables remain empty.

No production launch, real payment, message sending, DNS change or production-data import occurred. Staging build/deployment is complete; real provider acceptance and the remaining workflows in CONNECTED-CHECKOUT.md are still required. This documentation-only commit does not replace the deployed application revision.
