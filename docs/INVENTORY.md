# Inventory

Stock is a ledger. The number on the screen is a projection. If those two ever diverge, the ledger wins and the balance is rebuilt.

## States (quantities)

| Field | Meaning |
| --- | --- |
| `onHandQty` | Physical sellable units in the warehouse |
| `reservedQty` | Units promised to paid/open orders |
| **available** | `onHandQty - reservedQty` (computed; never stored as a writable source) |
| `damagedQty` | Unsellable, still on site |
| `inTransitQty` | Expected inbound (PO not yet received) |

`lib/domain/inventory.ts` implements available math, `applyTransaction`, and rejects negative on-hand, reserved, or available.

## Transaction types

| Type | Typical effect |
| --- | --- |
| `PURCHASE_RECEIPT` / `RECEIPT` | + on-hand |
| `CUSTOMER_RESERVATION` / `RESERVE` / `ROUTE_ALLOCATION` | + reserved (oversell rejected) |
| `RESERVATION_RELEASE` / `RELEASE` | − reserved |
| `ROUTE_LOAD` | No qty change; must already be reserved |
| `DELIVERY` / `SALE` | − on-hand, − reserved |
| `RETURN` | + on-hand |
| `DAMAGE` | − on-hand, + damaged (or inbound damage: + damaged only) |
| `LOSS` / `TRANSFER` / `TRANSFER_OUT` | − on-hand |
| `TRANSFER_IN` | + on-hand |
| `ADJUSTMENT` / `COUNT` | signed on-hand delta |

Each `InventoryTransaction` stores signed `quantity`, `resultingOnHand`, and `resultingReserved` after apply.

## Rules

1. **Ledger-only changes.** Services insert a transaction, then update `InventoryBalance` in the same DB transaction. No admin “set on-hand to 40” without a `COUNT`/`ADJUSTMENT` row and a reason.
2. **No silent overwrites.** Do not `UPDATE` a past transaction if someone typed the wrong qty. Insert a reversing txn plus a correct one.
3. **No negative / no oversell.** `rejectOversell` / `applyTransaction` throw `InventoryError`. The API translates that to 409, not clamp to zero.
4. **Receiving creates stock.** `ReceiptItem` is the operational document; the ledger row is the stock movement. Both are required.
5. **Sales do not skip reserve.** Paid orders reserve first; loading the route converts reserve → sale (Phase 3–4).

## Cost layers

On receive, sellable units open an `InventoryCostLayer` with `landedUnitCostCents` and `quantityRemaining`. Phase 3 checkout will consume remaining qty FIFO and snapshot `OrderItem.landedUnitCostCents`. Do not rewrite a layer's unit cost.

## What Phase 2 ships

- Domain `applyTransaction` + reorder recommendations
- Receiving desk, inventory dashboard, adjustments with audit
- Integration test: receive → balance; oversell rejected
