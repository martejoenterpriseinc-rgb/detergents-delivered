# Roadmap

Current owner-directed build scope: [full build and go-live contract](GO-LIVE-BUILD-CONTRACT.md). It includes the Render application authority, preferred storefront, dynamic ZIP map, matching responsive Website Builder, durable photos, Google login and password recovery. Reconcile the older phase statuses below against tested source before claiming completion.

Authoritative checklist for Detergents Delivered. A box is checked only when the work exists in this repo **with tests** (or an explicit non-testable artifact such as documentation or Docker files) **and** a working UI plus server-side security where the item is a product feature.

Later phases stay unchecked until implemented.

## Implementation reconciliation

The older phase boxes below are not a current launch verdict. Source and acceptance evidence in the following documents supersede stale descriptions such as “tax stub” or “local-only uploads.” Broad phase completion remains unchecked where related workflows or provider acceptance are missing.

| Area                                                            | Implemented evidence                                        | Remaining acceptance or scope                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Checkout, tax, immutable sale snapshots, reservations           | `CONNECTED-CHECKOUT.md`, `CONNECTED-CHECKOUT-ACCEPTANCE.md` | Actual provider/live tax acceptance; refunds and stock/reward reversals              |
| Customer account, support, access recovery                      | `ACCOUNT_SUPPORT.md`, `CUSTOMER-ACCESS.md`                  | Google and email provider acceptance; production owner onboarding                    |
| Delivery capacity, driver operations, attempts and proof access | `DELIVERY-COMMAND-CENTER.md`, `LAUNCH-DATE-ACCEPTANCE.md`   | Real route/provider/notification acceptance                                          |
| Loyalty, referral and promotion administration                  | `LOYALTY_DELIVERY.md`, `LAUNCH-OFFERS.md`                   | Refund reversals and full provider-backed lifecycle                                  |
| Shared storefront/Website Builder and current API row editor    | `STOREFRONT-BUILDER.md`, `API-ROW-EDITOR-RELEASE.md`        | Durable marketing uploads are implemented; actual hosted photo/redeploy acceptance remains |
| Durable operational photos and scheduled recovery               | `PRODUCTION-OPERATIONS.md`                                  | Exact CI/deployment and staging restore evidence recorded there; hosted photo/redeploy and production key recovery remain |
| Subscriptions, expenses, mileage, CPA, QBO and agent gateway    | Contract and phase definitions below                        | Substantial implementation remains                                                   |

## Phase 1 — Foundation

- [x] Next.js App Router scaffold with `(storefront)`, `(admin)`, `(driver)`, `app/api`, `lib/`, `prisma/`, `docs/`, `public/`
- [x] package.json scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:unit`, `db:generate`, `db:migrate`, `db:studio`
- [x] `.env.example` with all required placeholders (no real secrets)
- [x] Development / staging / production documented; production protected; development blocked from production-looking DBs
- [x] Dockerfile + docker-compose (app + Postgres)
- [x] PWA manifest + minimal service worker hook
- [x] Editable SVG logo at `public/brand/logo.svg`
- [x] README and architecture / ops documentation
- [x] Full core Prisma domain schema + initial migration
- [x] Money stored as integer cents in schema and helpers
- [x] Email/password sign-in + session
- [x] Roles: CUSTOMER, ADMIN, INVENTORY, DRIVER, CPA, SUPER_ADMIN
- [x] `requireRole` / `requirePermission` server helpers
- [x] Protected `/admin/*`, `/driver/*`, `/account/*`
- [x] Google OAuth ready when env vars are set
- [x] Dev-only SUPER_ADMIN seed from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
- [x] Bootstrap SUPER_ADMIN (`admin@detergentsdelivered.com`) with `mustChangeCredentials` and forced email+password change before `/admin`
- [x] Storefront home, admin nav shell, driver shell, `GET /api/health`
- [x] GitHub Actions: install, lint, typecheck, unit tests, prisma validate, build
- [x] Unit tests: money helpers
- [x] Unit tests: inventory available / reject negative / oversell
- [x] Unit tests: authorization helpers
- [x] `lib/domain` money + inventory + `TaxService` stub interface
- [ ] Live Stripe / QuickBooks calls (never a Phase 1 or Phase 2 item)

## Phase 2 — Products, categories, website catalog, inventory, PO, receiving, COGS

- [x] Category tree admin (category + subcategory CRUD)
- [x] Product + variant CRUD (SKU, UPC, scent, size, form, weight, dimensions, UOM, case pack, vendor link, tax category, reorder, active, website visibility, featured, delivery capacity)
- [x] Time-bounded `ProductPrice` rows (retail / subscription / sale). New rows for changes; amounts are not rewritten in place
- [x] Images via object-storage keys + local/dev upload stub; no public unsigned URLs for private assets
- [x] Admin create/edit forms (mobile-friendly, sectioned)
- [x] Catalog / purchasing / receiving APIs secured with `requireApiRole` (`ADMIN` / `INVENTORY` / `SUPER_ADMIN` writes; CPA read)
- [x] Storefront `/shop` + product detail from the **same** Postgres catalog
- [x] Shop lists published + active products with available inventory (or preorder)
- [x] Category browse + search / brand / in-stock filters
- [x] Vendor CRUD (contact, address, terms, notes, attachment metadata)
- [x] Purchase order lifecycle: `DRAFT` → `ORDERED` → `PARTIALLY_RECEIVED` → `RECEIVED` / `CANCELLED`
- [x] PO lines with qty, unit cost, discounts, freight, fees, taxes, other landed costs
- [x] Receiving: partial / shortage / overage / damage / cost notes; SKU / UPC / PO search
- [x] Receiving writes `Receipt` + `ReceiptItem` + `InventoryTransaction` and updates `InventoryBalance` from ledger rules
- [x] Negative on-hand and oversell rejected with clear errors
- [x] Inventory dashboard: value (landed layers), on-hand, available, reserved, low stock, out of stock, reorder recommendations
- [x] Adjustments require employee, datetime, qty, reason, notes + `audit_log`
- [x] Cost layers stored on receive for later sale-time COGS snapshots
- [x] Landed cost allocation + gross profit $ / margin % helpers (integer cents) with unit tests
- [x] `applyTransaction` + reorder recommendation domain functions
- [x] Demo seed path: vendor → variants → PO → receive → publish → `/shop`
- [x] Integration test: receive updates balances; oversell rejected
- [x] Admin website builder (section-based click-to-edit + publish; storefront home reads published sections). This is **not** a drag-and-drop / Figma-level designer.
- [ ] CSV import prototype (optional — not done)

## Phase 3 — Customers, cart, Stripe, tax

- [ ] Cart and checkout
- [ ] Customer admin / account order history
- [ ] Order + order item price snapshots (and `landedUnitCostCents` at sale)
- [ ] Stripe test-mode payments and webhooks → `PaymentEvent`
- [ ] Refund records (new rows, not payment overwrites)
- [ ] Inventory reservation on paid order
- [ ] Stripe Tax behind `TaxService` (still a stub today)

## Phase 4 — Delivery, routes, POD

- [x] Weekly route-day + time-window settings (admin-configurable, persisted in `Setting`, unit-tested `nextDeliverySlot`)
- [x] Chicagoland county enablement (full selectable list; seed defaults McHenry / Kane / Cook)
- [x] Storefront ZIP checker and copy read enabled counties + next weekly window (no same-day claims)
- [ ] Delivery zones and daily capacity (GeoJSON / `capacityPerDay` still later)
- [ ] Auto-schedule paid orders onto routes
- [ ] Driver stop list, attempts, photos
- [ ] Maps geocoding / basic optimization

## Phase 5 — Subscriptions, referrals, promotions

- [ ] Cadence, next-order date, pause/cancel
- [ ] Generate orders from subscriptions
- [ ] Skip / swap variant
- [ ] Dunning / past-due handling (with Stripe)
- [ ] Promotions and referrals

## Phase 6 — Expenses, mileage, CPA

- [ ] Expense capture
- [ ] Mileage trips
- [ ] CPA Center read models

## Phase 7 — Import/export, QuickBooks

- [ ] Import/export hardening
- [ ] Idempotent QBO sync (see [QUICKBOOKS.md](./QUICKBOOKS.md))

## Phase 8 — Reconciliation and hardening

- [ ] Operational + financial reports
- [ ] Reconciliation tools
- [ ] PWA offline improvements
- [ ] Production runbooks and backup drills
