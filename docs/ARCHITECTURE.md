# Architecture

Detergents Delivered is **one** Next.js application with one PostgreSQL database and one shared business-logic layer. Storefront, admin, and driver are UI modes, not separate deployables.

## Why one app

Household delivery is a single operating loop: catalog → order → tax → payment → reserve stock → purchase/receive → route → deliver → expense/mileage → books. Splitting those into micro-frontends or sibling products would duplicate authorization, money rules, and inventory state.

## Layers

```
app/(storefront)   app/(admin)   app/(driver)     presentation
        \               |              /
                 app/api/*                    HTTP adapters
                        |
              lib/authz  lib/prisma           application services
                        |
                   lib/domain                 pure rules (money, inventory, tax)
                        |
                     Prisma / Postgres        system of record
```

### `lib/domain`

Pure TypeScript. No HTTP, no Prisma, no Stripe. Unit-tested.

- `money.ts` — integer cents arithmetic, formatting, gross profit, margin
- `inventory.ts` — available = on-hand − reserved; `applyTransaction`; reject negatives and oversell
- `landed-cost.ts` — allocate freight/fees/tax/other across PO lines
- `reorder.ts` — low-stock / out-of-stock recommendations
- `tax.ts` — `TaxService` interface; Stripe Tax will implement this later
- `authz.ts` — role and permission predicates
- `delivery-schedule.ts` — weekly route days, windows, cutoffs, next slot, Chicagoland county catalog

Future integrations plug in **behind interfaces** in this layer or a thin `lib/integrations/` wrapper that the UI never calls directly:

| Integration         | Phase | Interface / notes                                                               |
| ------------------- | ----- | ------------------------------------------------------------------------------- |
| Stripe Payments     | 3     | Payment service; webhook → `PaymentEvent` append-only                           |
| Stripe Tax          | 3     | `TaxService.quote` → immutable `TaxCalculation`                                 |
| QuickBooks Online   | 7     | Sync worker; operational DB remains source of truth                             |
| Maps                | 4     | Geocode + distance; never the inventory source                                  |
| Email               | 3+    | Transactional only                                                              |
| SMS                 | 4     | Delivery windows / exceptions                                                   |
| Object storage (S3) | 2+    | Private media via storage keys; signed URLs later. Local stub writes `uploads/` |

No live Stripe or QBO calls ship in Phase 1 or Phase 2.

## Module boundaries

| Module     | Owns                                   | Must not                                   |
| ---------- | -------------------------------------- | ------------------------------------------ |
| Catalog    | Products, variants, categories, prices | Mutate inventory balances                  |
| Inventory  | Ledger + derived balances              | Rewrite historical receipts or costs       |
| Orders     | Cart snapshots, status, reservations   | Recompute old tax or prices                |
| Payments   | Provider events, refunds               | Treat webhooks as mutable                  |
| Delivery   | Zones, routes, stops, attempts         | Change order money                         |
| Accounting | Expenses, COGS views, QBO export       | Be the operational inventory source        |
| Identity   | Users, roles, sessions                 | Bypass `requireRole` / `requirePermission` |
| Website    | `SitePage` / `SiteSection` CMS         | Promise same-day delivery in default copy  |

## UI modes

Route groups do not change URLs; they keep layouts isolated.

- `app/(storefront)` → `/`, `/shop`, `/cart`, `/checkout`, `/delivery-area`, `/faq`, `/contact`, `/terms`, `/privacy`, `/refunds`, `/referrals`, `/sign-in`, `/register`, `/account`
- `app/(admin)` → `/admin/*`
- `app/(driver)` → `/driver/*`

Authorization is enforced twice:

1. `proxy.ts` — optimistic session cookie check (redirect to `/sign-in`, or `/account/change-credentials` when `mustChangeCredentials`)
2. Server layouts / `lib/authz.ts` — authoritative role, permission, and credential-change checks; Auth.js reloads persistent roles/deletion/credential state on every server session read

CPA is read-focused: allowed into the admin shell, denied write APIs.

## Runtime

- Next.js 16 App Router, Node.js runtime for `proxy.ts`
- Auth.js JWT sessions (credentials + optional Google)
- Prisma client singleton in `lib/prisma.ts`
- HTTP bind: `0.0.0.0:$PORT` for container hosts

## Environments

Development, staging, and production share the same artifact shape and differ by `APP_ENV`, `DATABASE_URL`, and secrets. Development must not use production data. See [DEPLOYMENT.md](./DEPLOYMENT.md).

## Source preservation during Render repair

The Render-linked GitHub history (Prisma 6/Auth.js) remains the repair base. The independent saved Prisma 7/Better Auth history and approved Sites layout are preserved separately; no incompatible migration/auth merge or UI replacement is performed. See RENDER_REPAIR.md.

## Account and support increment

`lib/services/customer-account.ts` owns self-service contact fields, notification preferences, credential changes and customer order reads. `lib/services/support.ts` owns ticket conversations and staff queues; it cannot mutate order/payment/delivery financial state. `lib/account-api.ts` handles authenticated JSON/Origin boundaries. `sessionVersion` is checked during each authoritative Auth.js JWT refresh to revoke old credentials after password replacement. Support identities always derive from User → Customer, not a posted customer ID or ZIP. See ACCOUNT_SUPPORT.md for additive migration and provider limitations.

## Loyalty and delivery account widget

The existing Customer/Referral/Order models remain authoritative. LoyaltyProgram configures snapshot referral terms; ReferralLink records owned invitation handoffs; RewardEntry is an immutable integer-cent ledger; RewardReservation serializes prospective credit tender. No second catalog or balance in localStorage is introduced. The current checkout can quote credits against current DB catalog prices but cannot spend them until the commerce finalizer is connected. `lib/services/reward-ledger.ts` is an internal transaction boundary, not a payment adapter. `lib/services/delivery-widget.ts` returns only the current account's saved status to a no-store poll endpoint. `account/entry` resolves persistent roles for the default login destination, while View as customer uses the same identity. Details and remaining payment/refund/verification gates: LOYALTY_DELIVERY.md.

## Delivery command center increment

The existing app now has a server-owned operations read model and transactional route actions. `operations.ts` supplies authorized customer/revenue/queue views; `delivery-operations.ts` serializes route execution and persists idempotent action receipts and every route leg. Customer status polls saved order/route state. Proof images are decoded and checked by ownership on retrieval. The only implemented proof storage adapter is development-local and cannot enable hosted route execution. Invite links are records, not authentication grants; email delivery is still unconnected. See DELIVERY-COMMAND-CENTER.md for the additive migration and open gates.

## Launch and offers increment

The existing Product/Variant/Price/Inventory, DeliveryZone/Vehicle/Route, Promotion and RewardEntry tables remain authoritative. `shop-entry.ts` creates catalog entries atomically and never invents stock. `launch.ts` stores a versioned cadence in Setting and reads paid-order demand without creating bookings. `promotions.ts` applies dated terms in a server-priced, read-only rewards quote. `purchase-eligibility.ts` distinguishes ZIP coverage from account/address authority and cannot open the unconnected checkout. Catalog media now has its own decoded namespace. Production startup requires a matching database environment marker initialized only in an empty database; no test records are promoted. See LAUNCH-OFFERS.md for transaction boundaries and remaining acceptance.
