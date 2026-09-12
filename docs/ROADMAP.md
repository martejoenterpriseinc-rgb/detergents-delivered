# Roadmap

Current remaining work and API-last sequence: [September 12 Go Live build audit](REMAINING-GO-LIVE-BUILD.md). This distinguishes implemented tipping, manual-payment approval and measured route-mileage controls from remaining settlement, tip accounting and provider acceptance requirements. The CPA financial event ledger passed PR 68 / CI 156; it does not establish bank reconciliation or complete financial statements.

Current owner-directed build scope: [full build and go-live contract](GO-LIVE-BUILD-CONTRACT.md). It includes the Render application authority, preferred storefront, dynamic ZIP map, matching responsive Website Builder, durable photos, Google login and password recovery. Reconcile the older phase statuses below against tested source before claiming completion.

Authoritative checklist for Detergents Delivered. A box is checked only when the work exists in this repo **with tests** (or an explicit non-testable artifact such as documentation or Docker files) **and** a working UI plus server-side security where the item is a product feature.

Later phases stay unchecked until implemented.

## Implementation reconciliation

The older phase boxes below are not a current launch verdict. Source and acceptance evidence in the following documents supersede stale descriptions such as “tax stub” or “local-only uploads.” Broad phase completion remains unchecked where related workflows or provider acceptance are missing.

| Area                                         | Implemented evidence                                                                                                            | Remaining acceptance or scope                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Checkout and original financial records      | `CONNECTED-CHECKOUT.md`, `SALES-REFUND-SOURCE-REVIEW.md`                                                                        | Intended payment/tax provider acceptance and controlled production order                                    |
| Refund settlement, stock returns and rewards | `REFUND-SETTLEMENT.md`, `REWARD-ONLY-REFUNDS.md`, `REFUND-SUBMISSION.md`, `REFUND-TAX-EVIDENCE.md`                              | Real provider lifecycle; compensation tax evidence and downstream compensation accounting                   |
| Customer account and access recovery         | `ACCOUNT_SUPPORT.md`, `CUSTOMER-ACCESS.md`                                                                                      | Google/email acceptance and production owner onboarding                                                     |
| Delivery capacity, driver operations and SMS | `DELIVERY-COMMAND-CENTER.md`, `ONGOING-DELIVERY-BOOKING.md`, `DELIVERY-TEXT-CONSENT.md`, `DELIVERY-TEXT-DISPATCH.md`            | Real route, consent, provider callback and notification acceptance                                          |
| Loyalty, referral and promotions             | `LOYALTY_DELIVERY.md`, `LAUNCH-OFFERS.md`, `REFUND-SETTLEMENT.md`                                                               | Provider-backed lifecycle acceptance                                                                        |
| Shared storefront and Website Builder        | `STOREFRONT-BUILDER.md`, `API-ROW-EDITOR-RELEASE.md`                                                                            | Hosted durable photo and redeploy acceptance                                                                |
| Quarterly subscriptions                      | `QUARTERLY-SUBSCRIPTIONS.md`, `QUARTERLY-CHECKOUT-CYCLES.md`                                                                    | Customer-reviewed payment acceptance; no automatic off-session charging is asserted                         |
| Expenses, mileage and CPA reports            | `FINANCE-RECORDS.md`, `ROUTE-MILEAGE.md`, `CPA-FINANCIAL-LEDGER.md`                                                             | Intended operating records and provider reconciliation acceptance                                           |
| Catalog exchange and scoped commerce gateway | `CATALOG-FILE-EXCHANGE.md`, `SCOPED-COMMERCE-GATEWAY.md`                                                                        | Real catalog/stock review and scoped client acceptance                                                      |
| QuickBooks expense, cost and receipt exports | `QUICKBOOKS-EXPENSE-POSTING.md`, `QUICKBOOKS-COST-JOURNALS.md`, `QUICKBOOKS-RECEIPT-DRAFTS.md`, `QUICKBOOKS-RECEIPT-POSTING.md` | Receipt posting passed full CI 149; real company acceptance and compensation accounting remain              |
| Hosted operations and retained records       | `PRODUCTION-OPERATIONS.md`, `BUILD-RELEASE-CANDIDATE.md`                                                                        | Exact release integration, current backup/restore proof, retained-record verification and production health |

The historical phase boxes below remain an archive of the initial plan, not a current feature inventory. Use `BUILD-RELEASE-CANDIDATE.md` for cumulative tested revisions and outstanding launch gates. The accounting, notification and payment providers used in automated tests are synthetic fixtures; these tests do not establish external acceptance.

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
- [x] Measured route mileage, precise correction history and report linkage (PR 70 / CI 161; hosted acceptance pending)
- [x] CPA Center expense/mileage and source-verified financial event read models (PR 68 / CI 156)
- [ ] Complete financial statements and bank reconciliation

## Phase 7 — Import/export, QuickBooks

- [ ] Import/export hardening
- [ ] Idempotent QBO sync (see [QUICKBOOKS.md](./QUICKBOOKS.md))

## Phase 8 — Reconciliation and hardening

- [ ] Operational + financial reports
- [ ] Reconciliation tools
- [ ] PWA offline improvements
- [ ] Production runbooks and backup drills
