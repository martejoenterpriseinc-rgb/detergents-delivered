# Startup repair evidence

Read RENDER_REPAIR.md and TEST_PLAN.md for scope and remaining gates.

- Local: 101 unit/mocked-HTTP tests, lint, typecheck and optimized build pass. Native hosted DB and browser tests are not claimed from these checks.
- GitHub CI: pending this review branch's run. The existing runner uses Node 22 and a fresh PostgreSQL 16 service with only synthetic data.
- New database/E2E guard requires `APP_ENV=development`, `DD_ALLOW_DATABASE_TESTS=true`, and `DATABASE_URL` pointing to loopback database `detergents_delivered_ci`. Refusing an unconfigured/hosted target is a guard result, not a database integration pass.
- Commands: `npm ci`, `npm run db:generate`, `npm run db:validate`, `npm run db:migrate`, `npm run check:runtime`, `npm run db:preflight`, repeat migrate/preflight, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run build`, `npx playwright install --with-deps chromium`, `npm run test:e2e`.
- Browser artifacts: `detergents-delivered-startup-evidence`, containing screenshots, Playwright traces/report and database assertion attachments. Real local database and credential sessions; no provider calls or real customers.
- No coverage threshold was lowered. The independent Prisma 7 checkpoint's coverage/native tests apply only to that source history and have not become passing tests for this Prisma 6 repair.

Launch verdict: **NO LAUNCH**. Hosted connection/configuration, migration inventory, hosted browser persistence and the commerce acceptance workflow remain blocked/unverified.
