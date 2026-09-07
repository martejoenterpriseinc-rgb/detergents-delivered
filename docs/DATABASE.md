# Database

PostgreSQL is the system of record. Prisma is the schema and migration tool. The initial migration creates the full core domain so later phases add workflows, not surprise tables.

## Conventions

| Topic             | Rule                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| IDs               | `cuid` strings                                                                                                          |
| Money             | `Int` cents. Currency defaults to `USD`. Never `Float` / `Decimal` for money.                                           |
| Physical size     | `Decimal` allowed for ounces/liters on variants — not money                                                             |
| Inventory qty     | Integers of sellable units                                                                                              |
| Soft delete       | `deletedAt` on users, customers, addresses, catalog, vendors                                                            |
| Financial history | No `deletedAt` on payments, events, refunds, tax snapshots, inventory transactions. Void or reverse with a **new** row. |
| Time              | `DateTime` stored in UTC                                                                                                |

`lib/prisma.ts` refuses a production-looking `DATABASE_URL` when `APP_ENV=development`.

## Entity map

### Identity

`User`, `Account`, `Session`, `VerificationToken` — Auth.js compatible.

`Role`, `Permission`, `RolePermission`, `UserRole` — RBAC. Role codes are the enum `CUSTOMER | ADMIN | INVENTORY | DRIVER | CPA | SUPER_ADMIN`.

### Commerce

`Customer` 1:1 with `User` (shoppers). Staff users may have no customer row.

`Address` belongs to a customer and may map to a `DeliveryZone`.

`Category` (tree), `Product` (brand + form + website flags), `ProductVariant` (SKU/UPC/scent/size/weight/UOM/reorder). Variants do **not** clone the whole product.

`ProductPrice` is time-bounded (`RETAIL` / `SUBSCRIPTION` / `SALE`). Change price by inserting a row.

`ProductImage` stores an object-storage key, not a public free-for-all URL.

### Purchasing

`Vendor`, `VendorProduct`, `PurchaseOrder`, `PurchaseOrderItem`, `Receipt`, `ReceiptItem`.

Landed cost = merchandise + freight + fees + tax + other, stored in cents on the PO and allocated onto receipt lines and `InventoryCostLayer` rows.

### Inventory

`InventoryTransaction` — append-only ledger. Application code must not `UPDATE` or `DELETE`.

`InventoryBalance` — derived projection (`onHandQty`, `reservedQty`, `damagedQty`, `inTransitQty`). Available quantity is computed: `onHand - reserved`. See [INVENTORY.md](./INVENTORY.md).

`InventoryCostLayer` — remaining qty × landed unit cost for valuation and future sale-time COGS.

`Attachment` — metadata (entity type/id + storage key) for vendor/PO/receipt files.

### Orders and money movement

`Order`, `OrderItem` (name/SKU/price snapshots), `Payment`, `PaymentEvent`, `Refund`, `TaxCalculation`.

`Subscription`, `SubscriptionItem` — cadence and next-order date. Origin order is optional 1:1.

### Delivery

`DeliveryZone`, `Vehicle`, `Route`, `RouteStop`, `DeliveryAttempt`, `DeliveryPhoto`, `MileageTrip`.

Weekly windows, cutoff hours, and enabled Chicagoland county codes persist on `Setting` key `delivery.settings` (JSON). See [ROUTING.md](./ROUTING.md). Seed defaults enable McHenry, Kane, and Cook only; admins can enable more counties from the catalog. Same-day delivery is not offered.

### Other

`Promotion`, `Referral`, `ExpenseCategory`, `Expense`, `AuditLog`, `Setting`.

## Indexes and uniqueness

- Unique: user email, role code, permission code, product/category slugs, variant SKU, optional UPC, order/PO/receipt/route numbers, payment `externalId` / `idempotencyKey`
- Indexed: foreign keys used in lists, order status, inventory txn `(variant, createdAt)`, postal code

## Audit

`AuditLog` records actor, action, entity, and optional before/after JSON. Financial ledgers are themselves the audit for quantity and money. Do not “fix” a captured payment by editing the row.

## Migrations

```bash
npm run db:migrate:dev   # local development
npm run db:migrate       # deploy / CI
```

Never edit an applied migration. Expand-contract for breaking changes. Production backups before migrate: [DEPLOYMENT.md](./DEPLOYMENT.md).
