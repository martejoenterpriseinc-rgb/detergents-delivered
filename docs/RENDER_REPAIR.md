# Existing app/database repair — September 8, 2026

Status: **review branch; hosted repair blocked; no launch**. No Render configuration, database, DNS, payment provider, worker, Site audience or unrelated application was changed.

## Source decision and preserved work

Repair base: GitHub `main` at `5538f9083d13e45c655cf482a4811eb74c7352f6`, the existing Render-linked repository. The failed Render deployment used older revision `151fe9c500c2171a4ec675dfe710ec112b8ba2cb`; later source changes have not been proven on Render.

The saved separate backend (`5a34c8aa598fa669c9d6406237dc783aacaf6c42`, implementation `f6c55c1a42535093cc3ee33ee4455f2cd92687ee`) uses Prisma 7/Better Auth and has no common git ancestor with this Prisma 6/Auth.js history. It remains preserved, as does the approved Sites design. This repair retains the deployed application's authentication/schema and makes no storefront/design replacement. Verified purchasing/safety changes from the saved branch still require selective porting; they are not implicitly merged or lost. Do not apply either history's migrations to the other's database.

## Confirmed fault and access blocker

The existing Detergents Delivered Render web service failed after a successful build: `prisma migrate deploy` reported P1012, missing `DATABASE_URL`. The service currently runs `npx prisma migrate deploy && npm start`, so attaching credentials and restarting could execute unreviewed migrations. Its existing dedicated PostgreSQL 16 database is available in Ohio. The connector's read-only schema query failed with connection EOF/TLS errors; no schema/history result was obtained. The database's public IP allowlist is empty. Do not weaken network restrictions to make the connector work.

The available Render connector can merge environment variables but cannot securely bind/retrieve the database's private connection value or change this existing service's start/pre-deploy commands. No private connection URL is present in this workspace. Secure dashboard configuration/internal runtime inspection is required to complete the hosted repair. Never paste the URL or authentication secrets into chat or git.

## Minimal changes

- Lockfile-based dependencies and Node 22 runtime pin, matching the existing CI/Docker major. Playwright is a pinned development-only dependency.
- Explicit runtime validation of environment, PostgreSQL target, auth origin/secret and non-production payment mode. Outside development, `DD_DATABASE_HOST` and `DD_DATABASE_NAME` must match the reviewed target. These are mistake-prevention checks, not network isolation or a credential security boundary.
- `npm start` runs configuration and **read-only** migration-history preflight before starting Next. No reset, push, seed or migration is run by npm start.
- Preflight compares retained migration SHA-256 checksums and ordered history, and distinguishes current, empty, pending, foreign, modified and failed histories. It does not claim full schema drift detection or backup/recovery proof. Empty/pending are nonzero review results, not permission to migrate.
- `/api/ready` returns 503 on configuration, database or required-schema failure, with no customer data or internal error detail. `/api/health` remains liveness only.
- Remove public default admin password and automatic bootstrap. Explicit non-production opt-in and a unique temporary password are required. Serialize bootstrap creation and refuse existing-address promotion, credential reset, soft-delete restoration and recreation after owner rotation.
- Refresh server session roles and deletion/credential state on each Auth.js read. Removed staff roles/deleted accounts no longer retain cached access. Identity/email verification, recovery, approval and rate-limit acceptance remain separate gaps.
- With demo flags disabled, the boot catalog helper no longer writes default delivery settings. Existing explicit/demo and website-builder behavior is otherwise retained; this is not a claim that every read path is free of seed behavior.
- Native integration/E2E tests refuse hosted targets; require explicit opt-in and a dedicated loopback test database. Preserve current migration SQL and all inventory/financial source behavior in this repair.

## Exact secure configuration procedure (not executed)

Use only the existing `detergents-delivered-staging` service and `detergents-delivered-staging-db`. Do not add a worker, replacement database, paid service or shared application credentials.

1. Preserve the database schema/migration inventory and a restorable backup if records exist. Before any redeploy, replace the old auto-migrating start command with `npm start`. Keep changes on this review branch until tests/review are complete; main currently has auto-deploy enabled, so merging is a deployment action.
2. In the web service's secure Environment page, enter `APP_ENV=staging`, `AUTH_URL=https://detergents-delivered-staging.onrender.com` (same for `NEXTAUTH_URL` if present), a unique generated `AUTH_SECRET`, and `DATABASE_URL` copied from this database's **Internal Database URL**. Pin `DD_DATABASE_HOST` to that URL's exact hostname and `DD_DATABASE_NAME=detergents_delivered_staging_db`. Set `DEMO_MODE=false`, `SEED_DEMO_CATALOG=false`, `SEED_BOOTSTRAP_ADMIN=false`. Leave live payment keys absent. Use **Save only**, not restart/deploy, while preparing the change.
3. Run `npm run db:preflight` from a securely authenticated runtime on Render's private network. The command deliberately prints only migration names/check results, never credentials or business rows. If no running shell is available, a reviewed staging deploy with this as its pre-deploy command can gather the read-only result; it must fail before migration/start for empty, pending, failed or foreign history. Deployment is separately gated by the owner's standing instruction.
4. Review that result. If empty or pending and the exact four retained migrations are approved, run `npm run db:migrate` once in the private runtime, then repeat preflight. For unknown/failed/checksum-mismatched history, stop for reconciliation; never reset or rewrite applied SQL. Existing SQL has two index replacements in the phase-2 migration; no table/data deletion is introduced here.
5. Run one-time administrator setup through secure temporary credentials only if the database has no administrator, then remove the temporary secret and disable the setup flag. Set health-check path `/api/ready`. Deploy the tested revision to this staging service only after the exact change is approved. Verify login, session separation and database persistence on the hosted URL. This does not authorize customer purchases or production.

Render's secure Save-only workflow: https://render.com/docs/configure-environment-variables

## Evidence scope

Local Node 24 workspace: 104 unit/mocked-HTTP tests passed after final review; lint, typecheck and optimized Next build passed. The build used a compile-only unreachable loopback URL, not Render credentials. The initial repair passed the existing GitHub CI on Node 22/native PostgreSQL 16: 101 unit tests, 16 integration tests, two browser tests and migration replay. The final review adds three unit cases; latest checks are attached to PR #12. No new hosting resource was created. Local native DB execution remains unavailable because this workspace maps only UID 0; tests must not bypass that restriction.

The repair adds native PostgreSQL tests for bootstrap concurrency, no reset/recreation, collision refusal and receiving regressions; migration preflight/replay; and desktop/mobile browser tests with actual local Auth.js sessions, admin/customer separation, persisted/audited vendor creation, bad credentials, refresh, role revocation and deleted-user denial. Screenshots, traces and database assertions are CI artifacts. They are not hosted sandbox, email, Stripe/Tax, storage, checkout or delivery acceptance. Exact CI outcomes are recorded in TESTING.md after execution.

## Remaining review findings

Receiving in this history still lacks a request idempotency key and locks the variant only after reading PO quantities; audit creation occurs after the receipt transaction. Exact landed-cost allocation across repeated partial receipts needs further reconciliation. No financial/receiving rewrite is bundled into a startup repair. The independent saved implementation has stronger receiving/idempotency/permission tests that must be reconciled carefully. Existing checkout/customer pages include simulations, and private upload, verified approval, zone-week/day booking, real payment/tax, worker and delivery/customer-photo workflows remain unaccepted. Quarterly-only and immediate purchase-payment requirements continue to govern later work; nothing in this repair implements deferred collection.

The app being able to start is not commerce or production readiness.
