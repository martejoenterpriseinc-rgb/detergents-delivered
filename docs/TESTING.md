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
