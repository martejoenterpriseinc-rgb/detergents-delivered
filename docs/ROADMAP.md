# Roadmap

Authoritative checklist for Detergents Delivered. A Phase 1 box is checked only when the work exists in this repo **with tests** (or an explicit non-testable artifact such as documentation or Docker files).

Later phases stay unchecked until implemented.

## Phase 1 — Foundation

- [x] Next.js App Router scaffold with `(storefront)`, `(admin)`, `(driver)`, `app/api`, `lib/`, `prisma/`, `docs/`, `public/`
- [x] package.json scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:unit`, `db:generate`, `db:migrate`, `db:studio`
- [x] `.env.example` with all required placeholders (no real secrets)
- [x] Development / staging / production documented; production protected; development blocked from production-looking DBs
- [x] Dockerfile + docker-compose (app + Postgres)
- [x] PWA manifest + minimal service worker hook
- [x] Editable SVG logo at `public/brand/logo.svg`
- [x] README and architecture / ops documentation (all files listed in the Phase 1 brief)
- [x] Full core Prisma domain schema + initial migration
- [x] Money stored as integer cents in schema and helpers
- [x] Email/password sign-in + session
- [x] Roles: CUSTOMER, ADMIN, INVENTORY, DRIVER, CPA, SUPER_ADMIN
- [x] `requireRole` / `requirePermission` server helpers
- [x] Protected `/admin/*`, `/driver/*`, `/account/*`
- [x] Google OAuth ready when env vars are set
- [x] Dev-only SUPER_ADMIN seed from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
- [x] Storefront home, admin nav shell, driver shell, `GET /api/health`
- [x] GitHub Actions: install, lint, typecheck, unit tests, prisma validate, build
- [x] Unit tests: money helpers
- [x] Unit tests: inventory available / reject negative / oversell
- [x] Unit tests: authorization helpers
- [x] `lib/domain` money + inventory + `TaxService` stub interface
- [ ] Storefront catalog, cart, and checkout (not Phase 1)
- [ ] Inventory receiving UI and live stock movements (not Phase 1)
- [ ] Live Stripe / QuickBooks calls (never in Phase 1)

### Phase 2 scaffold started (incomplete vs MVP)

- [x] Product / Category Prisma CRUD API stubs (`GET`/`POST` `/api/products`, `/api/categories`)
- [x] Admin products list page wired to the database
- [ ] Admin create/edit forms, variants, prices, images
- [ ] Public shop listing from the catalog

## Phase 2 — Catalog

- [ ] Category tree admin
- [ ] Product + variant CRUD (SKU, UPC, scent, size, form)
- [ ] Time-bounded `ProductPrice` rows (no in-place price history rewrite)
- [ ] Images via object storage keys
- [ ] Storefront browse / search (basic)
- [ ] CSV import prototype (optional)

## Phase 3 — Cart, checkout, orders, payments

- [ ] Cart and checkout
- [ ] Order + order item price snapshots
- [ ] Stripe test-mode payments and webhooks → `PaymentEvent`
- [ ] Refund records (new rows, not payment overwrites)
- [ ] Customer account order history
- [ ] Inventory reservation on paid order

## Phase 4 — Purchasing and inventory operations

- [ ] Vendors and vendor SKUs
- [ ] Purchase orders and receiving
- [ ] Ledger-only stock changes
- [ ] Cycle counts and adjustments with reason codes
- [ ] Prevent negative on-hand and oversell at the service layer

## Phase 5 — Delivery and driver

- [ ] Delivery zones and daily capacity
- [ ] Auto-schedule paid orders onto routes
- [ ] Driver stop list, attempts, photos
- [ ] Mileage trips
- [ ] Maps geocoding / basic optimization

## Phase 6 — Subscriptions

- [ ] Cadence, next-order date, pause/cancel
- [ ] Generate orders from subscriptions
- [ ] Skip / swap variant
- [ ] Dunning / past-due handling (with Stripe)

## Phase 7 — Tax, expenses, QuickBooks

- [ ] Stripe Tax behind `TaxService`
- [ ] Immutable tax snapshots
- [ ] Expenses and mileage posting
- [ ] Idempotent QBO sync (see [QUICKBOOKS.md](./QUICKBOOKS.md))
- [ ] CPA Center read models

## Phase 8 — Promotions, reports, polish

- [ ] Promotions and referrals
- [ ] Operational + financial reports
- [ ] Import/export hardening
- [ ] PWA offline improvements
- [ ] Production runbooks and backup drills
