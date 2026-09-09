# Delivery command center increment — 2026-09-09

This increment retains the existing Next/Prisma/PostgreSQL app and builds on PR14 / 6a8e268. It does not redeploy, migrate a hosted database, enable checkout, change DNS or provision resources.

## Requirement matrix

| Requirement | Implementation | Proof / remaining gate |
|---|---|---|
| Admin delivery, completion, daily revenue, MTD revenue, new/referral/total customer KPIs | Server queries, linked full pages, Chicago calendar boundaries; support KPI retained | operations unit/integration/browser tests; screenshots from synthetic database |
| Numbered map and ordered daily queue | OpenStreetMap browser tiles, saved coordinates, saved stop sequence, 15-second polling with stale state | Browser tests; tile availability depends on public OSM service; no geocoding or road-route optimization claimed |
| Start → navigate → arrive → proof → completed | Fresh DB staff roles; assigned drivers; row locks; only next stop; idempotent requests; failed upload cannot complete | Native PostgreSQL test, separate authenticated customer/admin browser sessions |
| Private customer photo | Ownership checked for every photo request; JPEG/PNG decoded, bounded pixels, re-encoded without metadata | Local development adapter only; durable private storage is a hosted launch blocker. Route start is blocked on staging until a supported adapter is connected |
| Interrupted routes | Started routes resume across date rollover; saved stop state survives refresh; duplicate photo requests return prior result | Integration/date rollover and browser refresh tests |
| Mileage history | Persist departure, each between-stop leg and return leg, retaining independent nullable planned/actual miles | No invented distances. Odometer/GPS capture and distance provider remain unconnected |
| Customer map/directory | Active customers, signup dates, paid orders, tax-inclusive totals minus refunds, referrer; search/group/city/sort/page | Server role check; optimistic version on edits; no changes to login/address verification |
| Add customer/invite | Expiring link, account/email collision check, rate limit, idempotency, audit record | Link creation only. Sending is visibly unavailable pending verified SendGrid sender/credentials. Invite confers no authentication or approval |
| Domain | Existing Render service inspected; no Cloudflare connector or DNS credentials available | Owner's DNS management access required; no changes made |
| iPhone notifications | Recommend installable web app first; iOS 16.4+ Home Screen web push is supported | Push subscription, permission UI, worker delivery and notification provider integration are NOT built by this increment |
| Existing commerce | Approved design, auth identity/roles, one database/catalog, quarterly subscriptions and immediate payment rules retained | Stripe checkout/tax/stock+capacity reservations remain gated as in the existing audit |

## Financial definitions

Daily delivery revenue counts each paid USD order once from the selected route service date. MTD counts paid USD orders by purchase date. Both include tax and subtract recorded refunds; these are operational order totals, not processor settlement or GAAP revenue. Customer order counts include non-draft orders. No live payments or balances are changed. Driver-only responses omit financial amounts.

## Migration and recovery

One additive migration adds RouteStop timestamps, immutable action receipts, route legs and invite records. No prior migration is rewritten. Foreign keys preserve historical records. New code requires this migration before hosted deployment; no hosted migration has been authorized/applied for this increment. Record/audit changes are atomic. Development photo writes precede transaction commit: a DB rollback can leave an unreferenced private file, never a falsely completed order. Durable-object cleanup and production recovery policy remain adapter work.

Route execution preserves saved paid booking assignments and original order totals. Schedule consolidation/editing and stock/capacity booking races belong to the pending commerce/scheduling integration and are not represented as complete here.

## Verification environment

Local dependencies were restored from cache using npm ci --offline --ignore-scripts; existing Prisma binaries explicitly selected to avoid downloads. Local runtime is Node 24, whereas repository CI and Render use the pinned Node 22 family. Cached PostgreSQL 16.14 binaries were located and copied into this task’s isolated tools directory. The workspace maps only UID/GID 0 and rejects non-root execution, so they cannot be used to run the required non-root database tests. No root-check patch or hosted-test workaround was used. The GitHub CI job supplies an isolated PostgreSQL 16 service, uses the existing loopback test guard, applies/replays migrations, and runs all tests. Synthetic tests use the actual sign-in flow and separate browser contexts. Local photos and fixture payment states are not a real Stripe sandbox or cloud-object-storage test.

## Domain handoff

Target service: detergents-delivered-staging.onrender.com. Before changing DNS: register apex/www with Render, review existing DNS and preserve email MX/TXT/DKIM/DMARC, point only the approved web hosts, verify certificate, set canonical AUTH_URL and review same-origin callbacks. Do not enable live payments during domain setup. No domain action was performed in this increment.

References checked 2026-09-09: Render configure-cloudflare-dns; WebKit Web Push for Web Apps on iOS and iPadOS; Waze Deep Links; OSM tile usage policy; Sharp constructor/output options.


## Recorded verification and blocked publication

- Local TypeScript, ESLint, Next production build succeeded on Node 24.19.0.
- 120 unit tests passed across 23 files, including real Sharp image decoding, metadata removal, malformed-image rejection and a mocked failed storage write.
- New native PostgreSQL and desktop/mobile browser tests are written but NOT RUN. Existing 31 database tests and six browser cases were proved for PR14 only; that evidence does not cover this increment.
- Automatic approval review rejected `git push` to the existing public `martejoenterpriseinc-rgb/detergents-delivered` repository. The first rejection cited an unverified destination. Read-only checks proved the remote matches Render, ancestry includes deployed 6a8e268, repository ownership/push access, and zero credential-pattern matches in added source. A second rejection still requires explicit approval for public source disclosure. No alternate GitHub write path was used; no branch/PR/deployment was published.
- Cloud Browser rejected a local `file:` preview URL. No browser-policy workaround was attempted. Review images are PDF-rendered visual previews of actual React components with synthetic props, explicitly NOT screenshots or browser/DB acceptance evidence. Interactive controls do not execute in these static documents.
- Launch verdict: NOT READY. Obtain explicit public-repository publication approval; run native PostgreSQL + separate-session mobile/desktop browser tests; connect durable private photo storage and verified invitation sender; complete existing commerce/tax/reservation blockers before production.
