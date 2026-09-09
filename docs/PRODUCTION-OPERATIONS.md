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

Record exact CI/source/deploy evidence in this document after it exists. At authoring, local checks pass; CI and hosted acceptance are pending.

Public launch still requires secure production owner onboarding, approved domain, actual Stripe/live tax and webhook acceptance, Google and transactional email setup, business/catalog/stock/delivery review, a tested restore, and controlled end-to-end acceptance. Refunds/reward reversals, quarterly subscriptions, expense/mileage/CPA workflows, QBO sync, notifications and the agent gateway are not completed by this increment.
