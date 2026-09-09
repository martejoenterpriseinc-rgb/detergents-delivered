# Production operations increment

This increment adds durable product photos, encrypted delivery proofs, lease-based payment/recovery-email workers, and actual operational status in Integrations. It does not establish live provider acceptance or public launch.

## Storage behavior

`OperationalMedia` stores sanitized image bytes separately from catalog/order DTOs. Uploads accept bounded JPEG/PNG content, normalize orientation, strip metadata and resize. Product links, image bytes, primary-image changes and audit records commit in the same transaction. A stable upload request key makes a lost-response retry return its original saved image. Failed processing, capacity or auditing preserves the previous record.

Draft product photos use an authenticated staff-only route with `private, no-store`. The public catalog route requires a published active product. Delivery proofs use AES-GCM, retained environment-specific keys and an authenticated context distinct from business documents. Their existing customer/driver/admin ownership checks remain authoritative. Catalog routes reject proof keys even if someone substitutes a catalog reference. Hosted legacy container-local uploads/downloads are disabled.

The initial bounded database storage budget is 250 MB catalog / 500 MB proofs, configurable with `DD_CATALOG_MEDIA_LIMIT_MB` and `DD_PROOF_MEDIA_LIMIT_MB`. Integrations reports saved bytes, counts and an 80% capacity notice. Increase the database's reviewed capacity before raising these limits. No automatic deletion of historical proofs or referenced images occurs. External S3 API fields remain pending an actual S3 adapter; saving those fields does not redirect this storage.

Database backups include the image bytes. Keep the encryption keyring securely recoverable outside the database and retain old key IDs through rotations. Losing a retained key makes its private proofs and documents unreadable. A restore drill must verify both records and key recovery before launch.

Website Builder marketing image uploads remain a separate unfinished requirement. A native Postgres durability test proves a second database client can read the saved bytes; browser tests cover refresh, authorization and duplicate retries. These tests do not replace a real hosted image/redeploy acceptance.

## Worker behavior

Run `npm run operations:work` in a dedicated background worker using the same environment's database identity and keys. Two independent loops claim environment-scoped database leases. Claims are serialized, renewed before bounded provider work and fenced at completion. Crashed workers become eligible after lease expiry. Failures retain a generic reason and exponential retry delay. Idle heartbeats distinguish a waiting worker from an offline worker.

Payment recovery reads protected pending attempts in fair batches through the existing reconciliation service. It cannot create a new charge or release an uncertain reservation. Unconfirmed session creation and review outcomes require attention. Credentials remain environment-specific. Ordering activation is independent.

Recovery email remains blocked until `DD_RECOVERY_DELIVERY_ENABLED=true` and the provider is configured. Missing setup consumes no delivery retries. Existing single-use token, delivery claim, recipient allowlist and retry-limit protections remain authoritative. No real messages are sent as part of deployment acceptance.

The Integrations panel and protected status API report actual heartbeat, last successful run, counters, failure/attention reasons and media usage. They do not claim that an unconfigured provider is connected.

## Deployment files

- `deploy/staging-jobs.render.yaml` creates only a DetergentsDelivered staging worker and references the existing staging web/database. It does not manage the existing web service or any BidSmooth resource.
- `deploy/production.render.yaml` creates a separate production web service, internal-only Postgres 16 database and worker. Initial checkout and email delivery remain disabled. No sandbox accounts, credentials, payments, orders, rewards or photos are copied.
- Production gets a newly generated authentication secret and separately supplied retained encryption keyring. Workers reference only their own web service's keys. Provider credentials are entered per line through that environment's API editor after owner access is established.
- `scripts/provision-production.ts` initializes only a pristine empty database, applies migrations and writes the production environment marker. An already marked database uses read-only preflight. An unmarked, nonempty or partially initialized database stops for inspection. It never seeds accounts or business records, resets data or automatically migrates later releases.
- A first worker start can wait for the web service's initial schema provisioning; subsequent starts require current migration history and the pinned database identity.
- Auto-deploy is off. Promote an exact CI-accepted revision. Disable automatic Blueprint sync after creation so later infrastructure edits remain reviewable before application.

## Acceptance and remaining launch work

Before promotion: full repository CI including native Postgres migration replay, upload/audit rollback, purpose/environment isolation, key rotation, concurrency and desktop/tablet/mobile lost-response tests. Capture a fresh hosted recovery checkpoint and compare retained table/column fingerprints across the additive migration. No financial snapshots are rewritten; `CheckoutAttempt.recoveryCheckedAt` is nullable recovery metadata.

Exact CI, deployment, retained-record and restore evidence is recorded below. This is an accepted infrastructure increment; public launch remains closed.

Public launch still requires secure production owner onboarding, approved domain, actual Stripe/live tax and webhook acceptance, Google and transactional email setup, business/catalog/stock/delivery review, a tested restore, and controlled end-to-end acceptance. Refunds/reward reversals, quarterly subscriptions, expense/mileage/CPA workflows, QBO sync, notifications and the agent gateway are not completed by this increment.

## Recovery drill evidence

On September 9, 2026, a fresh staging logical export completed at 23:05 UTC. An isolated PITR copy named `detergents-delivered-staging-restore-drill` (`dpg-daguhhmq1p3s7390dhh0-a`) restored the 22:59:53 UTC state. Read-only transactions over the private network compared every public table's ordered columns, row count and deterministic row fingerprint with the original staging database. All 71 tables matched, including migration history: `restoreVerified: true`, `changed: []`.

The temporary copy was deleted after verification. The original staging database and its completed export remain intact; no service was pointed at the copy. This establishes a staging record restore drill. It does not establish a real hosted photo/redeploy or production key-loss recovery exercise.

The first candidate's CI #79 passed 220 unit and 87 native Postgres checks but failed browser acceptance on an ambiguous alert selector and an existing 100-address review queue limit. The queue now has search, pagination and deleted-account filtering; its browser case includes a backlog over 100 addresses. CI #80 found typed pagination links at build time; these were corrected and validated with freshly generated local route types. Neither rejected candidate was deployed. Final source/deployment acceptance follows after the full gate passes.

## Accepted deployment — September 9, 2026

Application source: `b7f3af6d6ada7814285891bad6eb817ca889ca68`, tree `b49a38cedb366b5f1266d482cdd6acba86c8273e`, draft PR [#23](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/pull/23).

[CI #81](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34416488477) passed lint, freshly generated route types/build, migration application/replay, 220 unit checks, 87 native PostgreSQL checks and 31 desktop/tablet/mobile browser scenarios: 338 total. Artifact `10129428384` contains screenshots/traces; the product photo views were visually reviewed at all three widths. Earlier candidate failures above remain recorded rather than being counted as acceptance.

The additive staging migration completed with all 70 existing application tables' prior columns/rows unchanged (`preserved: true`, `changed: []`). Read-only preflight then reported 73 tables, 13 completed migrations, no pending migrations and no history problems.

| Resource              | Identifier                 | Accepted deploy            | Live at (UTC) |
| --------------------- | -------------------------- | -------------------------- | ------------- |
| Existing staging web  | `srv-daffhfqd0e5s73c76v2g` | `dep-dagunaeq1p3s73917mk0` | 23:31:37      |
| New staging worker    | `srv-dagunbeq1p3s73917v2g` | `dep-dagunbeq1p3s739180gg` | 23:29:36      |
| New production web    | `srv-dagunq61egvs73bpbm70` | `dep-dagunqe1egvs73bpbn90` | 23:32:19      |
| New production worker | `srv-dagup7m1egvs73bpjke0` | `dep-dagup7u1egvs73bpjlg0` | 23:33:39      |

Every deployed application/worker points at the accepted source above. The initial Blueprint plan references `c36cff0`; its YAML files are byte-identical to the accepted revision, and the actual deployed commit on each service was independently verified as `b7f3af6`.

Production: https://detergents-delivered-production.onrender.com. Its separate internal-only Postgres 16 database is `dpg-dagunau1egvs73bpantg-a`, database `detergents_delivered_production`. Both Blueprint Auto Sync settings and all service Auto Deploy settings are off. The existing staging service still targets old `main` in its service settings, so future staging promotions must continue to specify an exact accepted commit.

Hosted read-only acceptance: both web services returned readiness 200 and unauthenticated integration metadata 401. Production has its matching environment marker, independent authentication/encryption secrets and zero users, customers, products, orders, payment events or photos. Staging retained its 2 users, 1 customer and no business transactions. Both environments report current worker heartbeats with payment setup blocked for absent provider configuration and email delivery blocked until activation. No actual provider request, email or charge was made for acceptance.

The real production address was saved through the staging API editor. It persists in both Settings and Integrations. Switching to Production opens the new service and requires its separate sign-in; the staging owner's session does not grant production access. Hosted Settings was visually reviewed after saving.

Render's creation estimates were $21.50/month for production web/database/worker and $7/month for the staging worker ($28.50/month added, before any usage changes). The short-lived restore copy was removed after its drill.

## Next launch prerequisites

Production owner onboarding is not yet established: the clean production database deliberately has no privileged account, and development/staging bootstrap remains forbidden there. Set up a secure ownership-verification and first-owner credential-delivery path; do not clone the staging password hash, auto-promote an unverified customer, or put credentials in chat.

Live payment/tax/webhook and transactional email/OAuth acceptance, the approved custom domain, real catalog/stock/prices, business setup and delivery ZIP/capacity configuration are still missing. Private business PDFs still require a configured scanner; existing quarantine protections remain active. Complete the unfinished finance/refund/subscription/QBO/notification/gateway scope in the go-live contract. Checkout stays disabled until these required workflows and a controlled real acceptance order are accepted.
