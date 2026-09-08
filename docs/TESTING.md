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
