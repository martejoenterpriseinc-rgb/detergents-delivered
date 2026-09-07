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
2. Server layouts / `lib/authz.ts` — authoritative role, permission, and credential-change checks

CPA is read-focused: allowed into the admin shell, denied write APIs.

## Runtime

- Next.js 16 App Router, Node.js runtime for `proxy.ts`
- Auth.js JWT sessions (credentials + optional Google)
- Prisma client singleton in `lib/prisma.ts`
- HTTP bind: `0.0.0.0:$PORT` for container hosts

## Environments

Development, staging, and production share the same artifact shape and differ by `APP_ENV`, `DATABASE_URL`, and secrets. Development must not use production data. See [DEPLOYMENT.md](./DEPLOYMENT.md).
