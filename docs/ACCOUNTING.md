# Accounting

Detergents Delivered is an operating company that also keeps books — not a bookkeeping toy. The operational database is the first record of what happened. QuickBooks is a downstream ledger. See [QUICKBOOKS.md](./QUICKBOOKS.md).

## Non-negotiables

1. **No rewriting history.** Payments, refunds, tax snapshots, inventory transactions, and captured order lines are append-safe. Corrections are reversing entries.
2. **Minor units only.** Every money field is integer cents. Domain helpers in `lib/domain/money.ts` reject floats.
3. **Auditability.** Who, what, when. `AuditLog` for operational edits; ledgers for stock and cash.
4. **CPA access is read-focused.** The CPA role can inspect; it cannot “fix” captured numbers in place.

## Money on documents

| Document | Frozen fields |
| --- | --- |
| `OrderItem` | `unitPriceCents`, discounts, tax, line total, name/SKU snapshot |
| `Order` | subtotal, discount, shipping, tax, total |
| `TaxCalculation` | destination, taxable, tax, breakdown JSON |
| `Payment` / `Refund` | amounts; status changes via events or new refund rows |
| `PurchaseOrder` / lines | unit cost, freight, other, landed estimate |
| `ReceiptItem` | received qty, unit cost, allocated landed unit cost |

List prices in `ProductPrice` may change in the future; they do not mutate past orders.

## COGS and landed cost

Purchasing cost is not “last vendor quote on the vendor SKU.”

1. Record merchandise cents on the PO line.
2. Record freight and other costs on the PO.
3. On receive, allocate landed cost onto `ReceiptItem.landedUnitCostCents`.
4. Inventory valuation uses `InventoryCostLayer` rows written on receive. `VendorProduct.unitCostCents` is a convenience cache only — never the historical source of truth.

COGS on a sale uses the layer assigned when the unit left on-hand. If a count adjustment is required, it is a dated `InventoryTransaction` with a reason — not an UPDATE of an old receipt.

## Expenses and mileage

`Expense` rows are operational spend (warehouse supplies, fuel, software). Mileage trips capture operational miles; tax-deductible treatment is a reporting concern, not a reason to edit the trip.

## What Phase 1 is not

Phase 1 does not post journals, close periods, or talk to Stripe/QBO. It only makes it *impossible to model money as floats* and *hard to pretend history is mutable*.
