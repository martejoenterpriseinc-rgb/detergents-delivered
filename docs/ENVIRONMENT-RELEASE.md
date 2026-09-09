# Sandbox API release acceptance

Status: the approved sandbox API release is published and deployed to staging. Live hosting/provider setup and the separately tracked delivery-refresh issue remain open.

## Source and approval

- Owner approval covers publishing both feature branches to `martejoenterpriseinc-rgb/detergents-delivered` and continuing the reviewed deployment. No new generic push/deploy permission request is needed.
- Builder PR: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/pull/21
- Environment PR: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/pull/22
- Builder candidate: `672ba68a3bebdba7e99c4944542c37c95c906a80`.
- Deployed environment revision: `84db3873fcf373851358ab60f168ac9bfbcd5d86`; tree `fb3885364374b5ae36bfd3e896ee63ffbc8bc559`.
- Local continuation: `/workspace/detergents-release`, `release/environment-api-acceptance`. The original builder/environment worktrees remain retained. Source was published through the authenticated GitHub connector and fetched back; matching Git trees were verified. Existing branch ancestry was preserved without force pushes.

## Review corrections

CI65/66 found ambiguous alert selection in the new builder test: Next.js has its own route-announcer alert. The assertion now selects the editor's alert and retains the exact unsaved-change and injected-save-failure assertions.

CI67/68 advanced through durable photo upload, private draft access, refresh, failed-save retention and publication, then found multiple legitimate Sign in links. The test now waits for the iframe to exit edit mode and clicks the header login specifically. No case is skipped, no force click is used and no threshold is relaxed.

Release review found that converting existing `SiteSection.type` values in SQL would break the previous renderer during deployment. The not-yet-hosted builder migration was corrected before staging: it preserves saved types, and the new renderer adapts legacy fixed slots on read. A native PostgreSQL test verifies the rendered types while confirming the original rows remain identical. Previously completed hosted migration files were not changed.

CI72 passed the environment and builder cases but exposed a business setup race: an action clicked during autosave could be silently discarded. Actions now await the pending save, preserve failed edits and block duplicate submissions. Two focused unit tests cover successful and failed saves; the browser test holds a real profile save so the race is exercised on each device.

## CI acceptance

The deployable environment revision `84db3873fcf373851358ab60f168ac9bfbcd5d86` passed [CI74](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34406214796): fresh install, Prisma generation/validation, migration replay, lint, TypeScript, 202 unit/security checks, 69 native PostgreSQL integration checks, optimized production build and all 28 desktop/tablet/mobile browser cases. Browser evidence is retained by the workflow for 14 days.

Builder-only CI71 at `5ef7f9ea771903263140d17747e8dbb8206e934f` passed 174 unit, 69 PostgreSQL and 22 browser cases. After the business autosave correction, [CI73](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34406209493) at the newer builder head passed 176 unit, 69 PostgreSQL and 21/22 browser cases. Its desktop delivery case showed a completed status tile while the order card retained Out for delivery. The trace shows a successful status response without a subsequent route refresh. This is an open delivery-refresh consistency issue; do not treat the newer builder head as an accepted fallback or mark its PR fully green. The complete environment revision passed this case on desktop and mobile, but that does not establish that the intermittent issue is resolved.

## Staging preparation

- Service `srv-daffhfqd0e5s73c76v2g`, database `dpg-daffb9fqj5pc73f52560-a`, workspace `tea-d9nvrlnqj5pc73fmf610`.
- Running revision before release: `e99feb8a9db9816de5e375a19c6cd218bb107e6c`. Auto-deploy is off and configured `main` is older. Use a specific tested commit in Render; do not trigger the configured branch.
- Runtime inspection confirms `APP_ENV=staging`, the correct authentication origin and pinned database. Stripe, Google and email configuration names are absent. Checkout is disabled. No existing provider credential needs legacy binding for this rollout.
- A fresh complete logical export is available in Render Recovery, timestamp September 9, 2026, 13:57 Pacific. PITR is shown as available. A restore was not executed in this release.
- Before migration, read-only preflight reported 66 tables, 10 completed migrations and no history/checksum problems; only customer-access and storefront-builder were pending.
- Private record fingerprints cover 49 existing rows across 65 application tables. Raw records, credentials and signed backup URLs are not published. The new preservation check requires original columns/rows to remain identical; it permits only the explicitly added delivery-map section.

Applied migration SHA-256 values:

| Migration | SHA-256 |
| --- | --- |
| `20260912100000_customer_access` | `b576ee025538584024e2fcfee7b03f6f97d8bfcdfb0874b46a89e142497e6e23` |
| `20260913100000_storefront_builder` | `39df44de596f9f7882025f52fb069c70e8e40cd811f6543d6da96432adeb2027` |

## Release and recovery constraints

The two reviewed migrations were applied after CI74 passed, the completed backup was confirmed and an immediate preservation check passed. Post-migration preflight reports 71 tables, 12 completed migrations, no pending migrations and no problems. The preservation check passed at `2026-09-09T21:26:38.303Z`: all 49 original rows/columns remain identical and the expected delivery-map section raises the existing-table row count to 50.

Pinned Render deployment `dep-dagsu8eq1p3s738q72pg` started at `2026-09-09T21:26:57Z` and became live at `2026-09-09T21:29:54.841608Z` for the exact CI74 revision. The new instance confirms the same Git SHA. Both pre-deploy and runtime database checks report current history with no problems.

Hosted acceptance confirms:

- `/api/ready` returns `{"ok":true,"service":"detergents-delivered"}` from the running instance; unauthenticated `/api/admin/integrations` returns HTTP 401.
- The storefront and authenticated Settings/Integrations display the sandbox banner. Its computed background is `rgb(185, 28, 28)`, position is fixed and top is zero.
- Settings reports the staging API, Stripe webhook and Google callback origins; Manage sandbox API keys points to this service's Render environment editor. Live shows Not connected and its switch is disabled.
- Integrations reports staging with checkout closed, absent Stripe/Google/email configuration and the remaining provider verification/build work. No secrets are exposed in the UI.
- The consolidated admin navigation and saved Website page load with eight visible sections. The storefront renders the existing published content and the added delivery map with four active ZIP codes. The editor loads the same published content, its visitor preview has its own sandbox banner and all four ZIP centers render after loading.

Hosted checks are read-only application inspection. The full mutation, failure recovery, authorization and device browser checks ran only against isolated CI PostgreSQL data.

After those migrations, the old `e99feb8` startup preflight rejects the additional migration history. Do not use Render's old-deploy Rollback button blindly. A code rollback must retain the full migration inventory and support saved builder content. The builder inventory has the same schema, but its latest CI73 failure leaves it ineligible as an accepted fallback. Any fallback revision needs complete acceptance for the proposed source and configuration. Do not drop tables or erase new saved content to force an old application to start.

The separate live service, live URL and provider credentials are not configured. Live switching stays disabled. Real Google consent/callback, SendGrid inbox/worker delivery and Stripe sandbox checkout/tax/webhooks remain unaccepted. No live payment activation, customer message, production data migration, DNS change or unrelated project change is included.
