# API row editor release

The owner requested a clearer Settings and Integrations layout with Edit, Save/Update and status for every API row, plus a prominent Sandbox/Production switch. Both pages now share the same editor, covering 23 fields across Stripe, Google sign-in, SendGrid, Twilio, QuickBooks and S3-compatible storage. The last three remain explicitly marked Connector pending.

## Source and acceptance

Deployed application: `aaf9845b14eb2f22b6b4849fd600ae11eaec8e94`, tree `4f89b9bc99318413b083a223e6fd4152224dcbb9`, on `feature/environment-api-isolation` / draft PR #22. Publication and staging deployment were already authorized. Preserve the existing stacked PR base.

CI77: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34410921865

CI77 has passed fresh install, Prisma generation/validation, migration replay, lint, TypeScript, 216 unit/security checks, all 81 native PostgreSQL integration checks and the optimized production build. All 28 desktop/tablet/mobile browser cases also passed: 325 checks total. Browser evidence artifact `10127367628` is retained through September 23, 2026. Desktop, tablet and mobile screenshots were visually reviewed; the rows, statuses, masked saved value and top environment switch are readable without page overflow. The pinned staging deployment is live.

CI76 exposed a fixture interaction: commerce integration cases intentionally retain synthetic payment history, including pending attempts. The new global payment-credential safeguard correctly blocked subsequent vault saves. The integration script now runs the global configuration suite first against the clean migrated isolated CI database, then every remaining native suite. No test is skipped and the production guard is unchanged. Four explicit native cases check PREPARING, OPEN, PROCESSING and REVIEW attempts block Stripe writes even with checkout closed; fixture cleanup removes only the test owner's records.

## Behavior and security

Each row has a masked saved value, storage status and independent Edit, Save/Update and Cancel controls. Failed saves retain entered replacements, while successful saves and cancellation clear them. Shared version checks reject stale replacements. Secrets never return through the metadata endpoint or audit records and are encrypted using the retained hosting keyring. See `ENVIRONMENT-APIS.md` for key rotation and recovery requirements.

The top switch always identifies the current server-controlled environment. If the other app's URL is absent, Connect production saves a separate HTTPS destination. Saving that address does not provision a production service or switch the current service's APP_ENV. Opening a configured destination uses a full navigation. Sandbox records and credentials are not copied.

Managed Stripe, Google and recovery-email consumers read committed values without a restart. Storage success does not certify provider verification. Stripe edits remain blocked during checkout activation or pending payment recovery, and existing payment history prevents changing the Stripe account. Credential saves cannot enable checkout.

## Staging preflight

Service `srv-daffhfqd0e5s73c76v2g`, workspace `tea-d9nvrlnqj5pc73fmf610`, URL https://detergents-delivered-staging.onrender.com. Prior live revision: `84db3873fcf373851358ab60f168ac9bfbcd5d86`.

The application code from the candidate's parent passed the hosted runtime and read-only database checks: 71 tables, 12 completed migrations, no pending migrations or problems. The editor reports sandbox, secure saving available, 23 API fields, zero configured fields and no configuration problems. The candidate correction changes tests/scripts only. No new database migration or master key is needed; no hosted API credentials have been added.

## Deployment and hosted acceptance

Complete CI and visual review passed. The exact accepted commit was selected in Render Manual Deploy → Deploy a specific commit. Pinned deployment `dep-dagtmvmq1p3s738t8u20` started at `2026-09-09T22:19:42Z` and became live at `2026-09-09T22:22:37.451488Z`. Auto-deploy remains off; configured main is older than the running release.

Hosted owner inspection confirms both Settings and Integrations render the shared 23-row editor. All Edit controls are available; opening the Google secret row shows a blank input, Editing status, Save and Cancel, and cancellation returns to the original row. The Production button opens the Connect production dialog with an empty destination and disabled Save address. The staging API/callback/webhook URLs are correct, current Sandbox is selected, no fields are configured, and Integrations reports checkout closed. No hosted synthetic keys or destinations were saved.

The running instance confirms the exact accepted Git SHA, `APP_ENV=staging`, checkout disabled, successful `/api/ready` response and HTTP 401 for unauthenticated access to `/api/admin/integrations/fields`.

## Limits and recovery

Only the existing staging service is in scope. A production service/address and real provider credentials remain unconfigured. No provider acceptance, inbox delivery or real payment transaction is claimed. Hosted inspection uses no synthetic credential saves; all mutation and failure cases run only against isolated localhost PostgreSQL.

After an owner saves API keys, revisions before this editor will ignore the managed encrypted snapshots. Retain row-aware source and all referenced encryption keys together. Do not use an older Render rollback blindly. Existing migration inventory and saved builder content must also remain supported.
