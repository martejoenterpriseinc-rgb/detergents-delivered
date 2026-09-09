# Launch, catalog offers and capacity increment — September 9, 2026

This extends the retained Render-linked app after local commits `21e9c8a` and `4bc34ec`. No rebuild, provider calls, hosted migration, deployment, domain change, production write or customer message occurred. The previously saved audit and approved interface history remain intact. The original attachment files are not present in this restored workspace; the saved audit/architecture/testing documents and the user's full conversation requirements informed this increment.

## Requirement matrix

| Requirement | Local implementation | Remaining proof / limit |
| --- | --- | --- |
| Admin Shop online / Add inventory | `/admin/shop` and `/admin/shop/new`; title, description, SKU, selling/retail prices, computed savings, optional image, publish flag and vehicle load type/units | Product and prices are one atomic transaction with audit and idempotent replay. Quantities still come from Receiving. New native/browser cases prepared, not run |
| Image upload | Bounded multipart request, JPEG/PNG decoding, pixel limit, metadata removal, separate catalog namespace | Development adapter only. Hosted upload intentionally unavailable until durable storage is connected. Old arbitrary local image keys are refused; existing legitimate legacy product images require reviewed re-upload, not blind copying |
| Savings display | Same-variant retail-minus-selling savings; public cards/detail and server rewards quote use sale price when active | USD only. Retail comparison values must be accurate. No tax/settlement accounting is claimed |
| ZIP and purchase gate | Home, delivery-area, product and checkout ZIP checks read active database zones. Account identity, email verification, purchase approval, owned validated address and exact assigned zone are separate checks | New approval/validation fields default null. No existing customer is silently approved. Verification provider, address-validation workflow and admin approval UI remain gaps. Buy it now remains disabled while checkout is disconnected |
| Support KPI | Existing overview Support tickets KPI links to `/admin/support?status=ACTIVE` | Preserved; new browser case checks click-through. Previously recorded support workflow evidence remains scoped to its original revision |
| Launch date / order cutoff | `/admin/settings/launch` saves explicit launch date, inclusive Chicago cutoff date and first-delivery deadline. Default example October 15–31 is disabled | Enabling the banner does not open paid orders. Contact/support captures enquiries; no dedicated interest-order pipeline or preorder charge path is claimed |
| Monthly zone cadence | Calendar preview, zone weeks/day/vehicle assignment, explicit lock and separate unlock-save before changes | Week numbers mean Monday–Sunday calendar rows, including partial first/sixth rows. Cadence applies to future planning; existing routes/stops are never moved by these settings |
| Launch demand routing | `/admin/deliveries/launch` reads paid-status, unscheduled orders through cutoff, uses address zone, validates ownership, proposes dates from locked cadences, subtracts existing booked loads by vehicle/date | Read-only suggestions, not reservations, optimized stop sequences, verified Stripe receipts or promises. Uses current catalog load metadata, not historical checkout load snapshots. Missing loads/addresses block proposals. No new order processing is activated |
| Vehicle capacity | Saved stop count, shared space units, detergent bucket limit and scent-bead bucket limit; all four must pass | Existing active routes block reductions. Future booking must lock the vehicle/date capacity and inventory together. Per-SKU case/pack load treatment and weight/road limits need operational review |
| Configurable promotions | Dollar or percentage discounts, inclusive Chicago date range, minimum merchandise spend, maximum discount, all/first-purchase/referred audiences, pause, optional rewards combination | One code per quote. BOGO, item/category exclusions, campaign redemption limits, per-account limits and automatic campaign distribution are not implemented. Existing legacy capped promotions fail closed in the quote |
| Referral credits and rewards | Existing wallet/ledger preserved. Promo reduces merchandise first; rewards use at most remaining merchandise and keep the excess. Notice explicitly says preview | Final line-level discount/tax allocation, successful-payment spending, promotion redemption snapshots/limits and refund reward restoration remain checkout acceptance gaps |
| Test/live separation | Production rejects test/demo/local-storage flags, sandbox-named targets and test Stripe keys; startup/readiness requires matching database environment identity | Fresh production database/storage/auth/provider resources must be provisioned separately by owner approval. No production environment was initialized here |

## Recommended launch process

1. Review products, accurate retail comparisons, received stock, approved ZIP zones and vehicle loads.
2. Set launch/cutoff/first-delivery dates. Until the connected checkout is accepted, collect interest through Contact us; do not represent it as a paid order or reserved delivery.
3. Once payment/tax/stock/capacity acceptance passes, show the first-delivery window and obtain the customer's acknowledgement before immediate payment. Persist that promise on the order. Never defer collection until delivery.
4. Group incoming paid orders by validated location. Review capacity and lock the area's recurring calendar cadence. Optimize individual stop order separately for each run.
5. Confirm exact first-delivery dates through verified channels. Any paid booking changes require explicit review, capacity checks and customer communication; changing the template never moves them silently.

Quarterly-only subscriptions, payment at purchase, optional tipping, private delivery proofs, every route leg and separate planned/actual mileage remain requirements. No Waze ETA source or live payment integration is invented.

## Migration and transaction review

`20260909210000_launch_offers` is additive: nullable account approval/address validation, product load kind, safe-zero vehicle limits and promotion terms. Old migrations are unchanged. No customer/order/payment/receipt/reward record is backfilled or deleted. No schema was changed on Render. Existing source permits only synthetic native-test fixtures to populate approval/validation fields; no public setter accepts them.

Catalog create holds the authenticated user row for same-actor replay and writes product, variant, both prices and audit atomically. Unique SKU/slug constraints reject cross-actor races. File storage failure aborts before product mutation. A later database failure can leave an unreferenced file; a durable storage adapter needs orphan cleanup. Product image replacement and audit are atomic; catalog images cannot publish private proof keys.

Launch/zone resource edits share a transaction advisory lock, and launch revisions reject stale writes. Locked cadences reject week/day/vehicle/ZIP changes. Vehicle writes use row locking plus the prior update timestamp. Promotion edits serialize by code and reject stale versions. Current quote uses a repeatable-read database snapshot and integer cents; it neither changes financial rows nor reserves a promotion/wallet balance.

Automatic booking still needs one authoritative transaction boundary: recheck current authorization, address version, date/window/cutoff, availability and quote; lock stock and vehicle/date capacity; hold stock/rewards/capacity; use Stripe Sandbox idempotency and verified duplicate-safe webhooks; finalize paid order and immutable receipt; release holds safely on failures. The current planner and quote must not be mistaken for that finalizer.

## Clean production initialization (prepared, not performed)

- Keep the existing staging database and synthetic records isolated. Do not promote, clone or clean it into production by deleting rows.
- Provision a separate empty PostgreSQL database and separate storage namespaces/buckets, Auth secret/origin, Stripe live account resources/webhook endpoint and notification credentials. Keep staging provider credentials and messages isolated.
- Apply reviewed migrations to the new empty database. With explicit owner authorization, run `scripts/initialize-empty-environment.ts` using the temporary `DD_INITIALIZE_EMPTY_DATABASE=true` opt-in. The script refuses any existing application data and records a project/environment/database marker. Disable the opt-in afterward.
- `db:preflight` and readiness fail production when the marker does not match. This is a guard, not proof that a provisioned environment is clean. Backups, restore exercise, owner account bootstrap/invite, verified catalog/config import and full acceptance are still required. Import only reviewed business configuration/catalog; no test customers, orders, receipts, rewards, tickets, photos or provider events.
- No live checkout switch is supplied. Production remains closed until end-to-end acceptance and explicit owner launch approval.

## Evidence and remaining blocks

- Local: 138 unit/mocked checks in 27 files pass. Actual Sharp pixel decoding is tested; file writes in image unit tests are explicitly mocked.
- Local optimized Next production build passed; final lint and TypeScript results recorded in TESTING.md after the final checks.
- Prepared: four native PostgreSQL integration cases in `lib/services/launch-offers.integration.test.ts`, covering duplicate creation, failed image writes, permissions, sale/promotion/reward arithmetic, no financial mutation, shared-ZIP ownership, cadence/ZIP locks and capacity protections.
- Prepared: `e2e/launch-offers.spec.ts` runs under the existing desktop/mobile projects with separate admin/customer sessions, refresh checks, database assertions, support KPI navigation and screenshots. No new browser screenshots were captured this turn.
- Native/browser execution remains blocked by the saved non-root PostgreSQL namespace restriction. No database or browser policy bypass was attempted. Existing GitHub CI can run these once source publication is authorized.
- Automatic approval review previously rejected pushing to the existing **public** GitHub repository because explicit public-source disclosure approval was missing. This request adds features; it does not supply that approval. No push, PR, migration or deployment was attempted for this increment.

**Launch verdict: NO LAUNCH.** A provider key alone does not close the documented checkout, reservation, verification, storage, worker, receipt/refund and acceptance gaps.
