# DetergentsDelivered release and domain cutover

Owner direction September 13: finish the existing application, connect APIs last, and use
the purchased detergentsdelivered.com domain. This document records preparation, not a
completed release or permission to skip outstanding application work.

## Verified starting point

- Repository: `martejoenterpriseinc-rgb/detergents-delivered`.
- Candidate PR84: `f2ea1db5d62fa7d0e9f3d0c6eb2c79f2dba3d9e6`.
- CI198 passed: 422 unit, 286 PostgreSQL and 92 browser tests, migrations, lint,
  typecheck and production build. Tests use isolated synthetic provider evidence.
- Production web: `srv-dagunq61egvs73bpbm70`; worker: `srv-dagup7m1egvs73bpjke0`.
- Production database: `dpg-dagunau1egvs73bpantg-a`.
- Production remains on `a2495c4afa459a9c258804841fa37b038ecdd828`; its configured
  `feature/production-operations` branch is stale. Auto-deploy remains off.
- Render domain setup completed: apex and www are associated with the production web
  service. Both report Waiting for DNS / Waiting for Verification. www redirects to apex.
- GoDaddy domain management opens at sign-in. No DNS records were inspected or changed.
- Read-only hosted SQL again failed with TLS/connection errors. Backup/restore readiness
  and hosted migration history remain unverified. Do not weaken TLS or publicize the database.

## Release preparation implemented here

`deploy/release-migrations.json` pins the 15 retained migration checksums from deployed
source and all 21 additional files through PR84. Retained SQL was compared byte-for-byte
with the baseline. No migration SQL changes are introduced by this preparation.

`npm run db:release-check` uses the existing read-only database inspector, including its
runtime/database identity checks, and compares the entire local migration manifest and
the exact pending suffix. Unknown history, changed SQL, unfinished history, invalid counts,
missing inspection and a database older than the baseline stop the check. A matching
partially applied release can be inspected without replaying anything.

Exit 0 means schema current for the manifest; exit 2 means a known pending suffix; exit 1
means blocked inspection. **None of these results authorizes or executes migrations.**
The candidateCommit identifies the source of the migration set, not certification of every
future application revision. Record and test the actual deployment SHA separately.

The financial report page now supports historical custom ranges and full-report/section CSV
downloads. These retain provider company/mode/basis, escape spreadsheet formulas and fail
closed on unavailable reports or changed section labels. Real provider acceptance remains open.

The production Blueprint now retains the custom domains and uses `npm run db:preflight`
instead of initial provisioning. Do not reapply the Blueprint blindly: its configured branch
and public origins still match the existing pre-cutover service. Update them only in the
reviewed release/domain step. Existing encryption keys and credentials must be retained.

## Exact release order

1. Finish the open application items below. Review and integrate the existing stacked PR
   chain without dropping changes, bypassing required checks or creating a replacement app.
2. Run all required CI against the actual combined release SHA. Review the migration diff
   and update this manifest if later application work adds migrations; do not rewrite applied SQL.
3. Restore database inspection access using a supported private, TLS-verified connection.
   Verify both environment markers, migration history and checksums. Do not use production
   credentials for local tests or copy its records to a synthetic test suite.
4. Before each hosted migration, obtain current recoverable database backup and restore
   evidence, preserve encryption keys, stop writes and workers, and capture retained-record
   fingerprints with `scripts/check-record-preservation.ts` on that host.
5. On staging first, inspect with `db:release-check`, execute only the reviewed migration
   chain through the existing operator procedure, then run preflight, release check and
   retained-record verification. Fingerprints are not backups. Keep traffic closed on failure.
6. Deploy the exact accepted application SHA to staging web and worker. Verify readiness,
   owner login, 30 KPI drilldowns, CSV, builder publication, persistent uploads and recovery.
7. Repeat the protected migration/release procedure on production, with production-specific
   backup and identity evidence. Do not use the old two-migration refund-foundation script.
8. Complete domain cutover below. Connect APIs only at the owner's final setup stage.
9. Verify intended-provider workflows and a controlled end-to-end order before enabling
   commerce. Check monitoring, worker health, restore and owner/business/catalog/capacity data.

## Domain cutover

Keep Render as the application host. The purchased domain becomes the public address;
this requires no GoDaddy hosting purchase or transfer of the domain registration.

Inspect the domain's authoritative DNS and existing records first. Purchasing at GoDaddy
does not prove GoDaddy hosts its DNS. Preserve all MX, email verification, SPF, DKIM, DMARC
and unrelated subdomain records. Record the previous affected values for rollback.

If GoDaddy is authoritative, configure the following records from Render's displayed setup:

| Type  | Name | Value                                        |
| ----- | ---- | -------------------------------------------- |
| A     | @    | 216.24.57.1                                  |
| CNAME | www  | detergents-delivered-production.onrender.com |

Replace conflicting website records/forwarding only. Check conflicting apex/www AAAA and
restrictive CAA records; preserve other services. If DNS is hosted on Cloudflare, use its
documented flattened apex CNAME instead of applying the GoDaddy A-record procedure.

Verify both domains in Render and obtain valid HTTPS before changing application origins.
Verify the target is this production service, not staging or a parked website.

Update production web AND worker together:

| Setting            | Value after HTTPS verification                    |
| ------------------ | ------------------------------------------------- |
| AUTH_URL           | https://detergentsdelivered.com                   |
| NEXTAUTH_URL       | https://detergentsdelivered.com                   |
| DD_LIVE_APP_URL    | https://detergentsdelivered.com                   |
| DD_SANDBOX_APP_URL | https://detergents-delivered-staging.onrender.com |

Update the sandbox's live-switch destination, including any saved managed destination
override. Keep the sandbox's own auth origin and credentials unchanged. Review existing
origin-bound integration bindings before cutover: a stored credential envelope does not
automatically authorize a new origin. Do not decrypt credentials into chat or logs.

At the deferred API setup use the new production callbacks, including Google
`/api/auth/callback/google`, Stripe `/api/stripe/webhook`, and QuickBooks
`/api/admin/quickbooks/callback`. Confirm every callback from the actual integration screen.
Verify recovery links, invitations, checkout return URLs, customer login and admin writes.
Expect existing host-scoped browser sessions to require sign-in on the new domain.

Keep the onrender address available until the custom domain, provider callbacks and the
sandbox/live switch pass acceptance. Only then disable it if desired; Render disabling
returns 404 rather than redirecting old bookmarks. Do not disable an address still used by
callbacks. Rollback requires restoring consistent origins AND affected DNS; never reset data.

References: https://render.com/docs/configure-other-dns and
https://render.com/docs/custom-domains (reviewed September 13).

## Actual open application work

| Area                | Remaining completion                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failed card refunds | Provider-compatible tax compensation evidence and correcting QuickBooks transactions; intended Checkout behavior must be verified before implementing a tax-writing correction.                                                                                |
| Tip accounting      | Dedicated QuickBooks liability/refund/driver-payout posting and reviewed resolution of uncertain claims with no provider creation. Refund webhook routing is now implemented; connected provider acceptance remains open. Existing refund initiation, partial allocations, transfer records and scheduled reads are implemented. |
| Manual cash/Zelle   | Received-funds exceptions for expired/revoked approvals, late receipts and delivery rescheduling; reviewed never-created tax-claim resolution. Normal settlement, manual refunds and standalone tax reversals are implemented.                                 |
| Provider reports    | Complete remaining scale/export and tax-report acceptance in QUICKBOOKS-FINANCIAL-REPORTS.md. Unsupported payment provider metrics remain explicitly unavailable until ingestion/acceptance.                                                                   |
| Final acceptance    | Real owner/business setup, catalog/stock/photos, ZIP/calendar/capacity, durable media, restore, worker and end-to-end checks on the deployed revision.                                                                                                         |

The domain association and migration-review tool do not close these items. APIs remain
unconnected and activation flags remain unchanged. Launch is not declared ready.

## September 13 continuation: refund webhook routing and release blockers

The existing signature-verified Stripe endpoint now routes `refund.created`,
`refund.updated`, and `refund.failed` to the dedicated tip refund reconciler.
Account, mode, tip and original PaymentIntent bindings are checked. Events are lookup
hints only: reconciliation reads current provider evidence and uses the existing
claim audit, tip lock and concurrency check. Duplicate or delayed delivery cannot
apply event-supplied financial values. Missing app claims and unavailable evidence
return a retryable failure. No refund is submitted by this path, and no migration
or provider activation is introduced. Subscribe to these events during deferred API
setup and verify delivery/retries in the connected sandbox before live acceptance.
Reference: https://docs.stripe.com/api/events/types and https://docs.stripe.com/webhooks.

Read-only migration queries against both staging and production again failed with
EOF/TLS-required connection errors. Production database metadata confirms it is
available with an empty public IP allowlist. An SSH connectivity check to the
existing production service failed DNS resolution before authentication. No network
access rules or TLS settings were changed. These checks provide no current backup,
restore, hosted migration-history or encryption-key recovery proof. Existing September
9 staging restore evidence does not certify current production recovery.

Hosted migration and release remain blocked until a supported authenticated private
operator connection and current recovery evidence are available. Do not trigger web
or worker deployments independently or bypass the release order above. Other open
application items remain open; this continuation is not a complete release.
