# Startup repair evidence

Read RENDER_REPAIR.md and TEST_PLAN.md for scope and remaining gates.

- Local: 104 unit/mocked-HTTP tests pass after final review, plus lint/typecheck. Optimized build passed on the initial repair. Approved Sites regressions: 24/24 pass; Site source unchanged. These local checks do not claim a hosted database connection.
- GitHub CI at `cc1bed83aac78ce8ef6fa5c742cb6125b6327cbb`: **passed**, 101 unit tests, **16 native PostgreSQL integration tests**, **2 desktop/mobile browser tests**, lint/typecheck/build, four migrations applied and replayed with no pending changes. [Exact run](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34254362585).
- [Screenshots/traces/database assertions](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34254362585/artifacts/10067320860): 8,631,985 bytes, 14-day retention. These are real isolated PostgreSQL 16/Auth.js tests, not real provider sandbox tests.
- Final review adds two production-target rejection cases and a disabled-demo boot test (104 unit tests). The same native/browser gates rerun on that commit; [PR #12 checks](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/pull/12/checks) and its evidence summary identify the latest tested revision.
- New database/E2E guard requires `APP_ENV=development`, `DD_ALLOW_DATABASE_TESTS=true`, and `DATABASE_URL` pointing to loopback database `detergents_delivered_ci`. Refusing an unconfigured/hosted target is a guard result, not a database integration pass.
- Commands: `npm ci`, `npm run db:generate`, `npm run db:validate`, `npm run db:migrate`, `npm run check:runtime`, `npm run db:preflight`, repeat migrate/preflight, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run build`, `npx playwright install --with-deps chromium`, `npm run test:e2e`.
- Browser artifacts: `detergents-delivered-startup-evidence`, containing screenshots, Playwright traces/report and database assertion attachments. Real local database and credential sessions; no provider calls or real customers.
- No coverage threshold was lowered. The independent Prisma 7 checkpoint's coverage/native tests apply only to that source history and have not become passing tests for this Prisma 6 repair.

Launch verdict: **NO LAUNCH**. Hosted connection/configuration, migration inventory, hosted browser persistence and the commerce acceptance workflow remain blocked/unverified.

## Account/support increment (September 9)

Adds `lib/services/customer-account.integration.test.ts`, `lib/domain/account.test.ts`, `lib/account-api.test.ts`, and `e2e/account-support.spec.ts`. Existing CI runs both old and new regression suites, all migrations/replay, and browser projects. New tests use only synthetic local/CI PostgreSQL records. Browser HTTP 503 injection is explicitly a mock failure; the successful session/database paths use actual Auth.js/PG. No provider sandbox test is inferred. Results pending CI; see ACCOUNT_SUPPORT.md and the incremental PR.

## Passing implementation evidence

Implementation revision `7c6d29f351e683f65ae3d1bda8edc7c27b7bcafb`: [CI run 34296706230](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34296706230), job 102294799607, passed all gates. Node 22 / PostgreSQL 16: **109 unit/mocked HTTP checks, 23 native integrations, 4 desktop/mobile browser tests**, lint/typecheck/optimized build and Prisma validation. Applying/replaying the five migrations reports 51 tables, five completed migrations and no pending problems. The existing four migration SQL files are byte-for-byte unchanged. New migration SHA-256: `2158ce72430ca0a1b602214a1f4070eab019b88edc9cd09887346e378329a99a`.

[Browser screenshots, traces and database assertions](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34296706230/artifacts/10083442163) are 30,735,732 bytes (artifact 10083442163; expires September 23 in GitHub). The customer/staff account workflow passes in 8.4 seconds desktop / 7.7 seconds mobile. It proves account edits/preferences after refresh; owned-order ticket creation; other customer / staff-role / cross-origin denials; staff reply, resolve and customer reopen; support KPI drilldown/filter/CSV; failed-save display without database mutation; password replacement invalidates both existing sessions, rejects the old password and accepts the new one; order monetary fields remain unchanged. Successful account/support paths use real isolated PG/Auth.js, while the failed-save response is an explicitly injected HTTP 503. No hosted or real external provider test is claimed.

All implementation gates for this increment pass in CI. Hosted staging migration/deployment and owner verification are pending. Existing broader commerce/production gates remain unchanged: **NO PRODUCTION LAUNCH**.

## Loyalty, live delivery tiles and role-aware entry

Adds `lib/domain/loyalty.test.ts`, `lib/services/loyalty.integration.test.ts`, and `e2e/loyalty-delivery.spec.ts`. Existing suites are retained; the admin login expectation is updated from `/account` to the requested `/admin` behavior. Native tests use real isolated PG; payment `verifiedAt` rows are explicitly synthetic fixtures, not provider calls. Browser scenarios separately authenticate owner/customer/friend, prove same-identity View as customer, persisted settings and referral credits, equal tiles and normal timer polling, recovery after injected HTTP 503, and server-priced rewards preview with no actual wallet/order mutation. Final results and artifacts are tied to the exact commit in the incremental PR. No production/provider launch acceptance follows from these tests.

## Delivery command center — 2026-09-09

Local evidence: Next production build, lint, TypeScript and 120 unit tests pass. Four photo-adapter unit cases use actual Sharp decoding with mocked object writes. `operations.integration.test.ts` adds native PostgreSQL assertions for customer permissions/version races, idempotent invitations, assigned routes, sequence, duplicate requests, upload failure/recovery, shared-ZIP photo ownership, date-rollover recovery, duplicate bookings and unchanged order amounts. `e2e/operations.spec.ts` adds separate-session desktop/mobile browser cases and screenshot capture.

These new PostgreSQL/browser cases are **prepared, not executed**. The local UID/GID namespace maps only root and rejects non-root PostgreSQL execution. The initial public-source publication review was rejected; the owner has since explicitly approved publication. Command-line git push now fails for missing GitHub credentials; the connected publication path is being assessed. Do not use PR14's prior database/browser evidence as proof for this increment. Review PNGs are static PDF-engine renders of actual React components with synthetic props, not browser acceptance screenshots. No thresholds were lowered, no database guard bypassed and no live target tested.

## Launch, offers and capacity — September 9 continuation

Local verification on the retained branch: **138 unit/mocked tests in 27 files pass**, ESLint passes, TypeScript passes and the optimized Next production build passes. A missing Link import in the new delivery-settings navigation was caught by lint, corrected and the final lint/typecheck/build rerun passed. Node is 24.19.0 locally; Node 22 remains the authoritative CI runtime. No coverage threshold was changed.

New native PostgreSQL tests: four cases in `lib/services/launch-offers.integration.test.ts`. New browser case: `e2e/launch-offers.spec.ts`, configured for desktop/mobile and separate customer/admin sessions. These are **prepared but not run** under the previously recorded PostgreSQL/publication blocks. No new browser image or actual Stripe/Tax/SendGrid/storage sandbox evidence exists. Sharp unit tests decode real synthetic pixels while storage writes are mocked. See LAUNCH-OFFERS.md for exact scope and remaining gates.

The additive `20260909210000_launch_offers` migration was generated/reviewed locally, not applied to any database. All existing migration files are preserved unchanged. New database readiness probes cover its columns. Do not deploy the application before native migration replay and browser acceptance pass for the exact revision.

Launch-date follow-up: changed-date/revision persistence and injected failed-save browser assertions added, plus unauthorized/invalid-date database rollback assertions. Execution remains pending native CI; no new database/browser pass is claimed.
