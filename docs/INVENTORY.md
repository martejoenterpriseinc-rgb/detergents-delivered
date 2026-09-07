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

`lib/domain/inventory.ts` implements available math and rejects negative on-hand, reserved, or available.

## Transaction types

`InventoryTxnType`:

| Type | Typical sign | Effect |
| --- | --- | --- |
| `RECEIPT` | + on-hand | Receiving |
| `SALE` | − on-hand, − reserved | Shipped / loaded for delivery |
| `RESERVE` | + reserved | Paid order |
| `RELEASE` | − reserved | Cancel / expire hold |
| `ADJUSTMENT` | ± on-hand | Documented correction |
| `RETURN` | + on-hand | Customer return to sellable |
| `DAMAGE` | − on-hand, + damaged | Breakage |
| `COUNT` | ± on-hand | Cycle count variance |
| `TRANSFER_IN` / `TRANSFER_OUT` | ± on-hand | Future multi-location |

Each `InventoryTransaction` stores `quantity` (signed), `resultingOnHand`, and `resultingReserved` after apply.

## Rules

1. **Ledger-only changes.** Services insert a transaction, then update `InventoryBalance` in the same DB transaction. No admin “set on-hand to 40” without a `COUNT`/`ADJUSTMENT` row and a reason.
2. **No silent overwrites.** Do not `UPDATE` a past transaction if someone typed the wrong qty. Insert a reversing txn plus a correct one.
3. **No negative / no oversell.** `rejectOversell` / `applyOnHandDelta` throw `InventoryError`. The API must translate that to 409, not clamp to zero.
4. **Receiving creates stock.** `ReceiptItem` is the operational document; the ledger row is the stock movement. Both are required in Phase 4.
5. **Sales do not skip reserve.** Paid orders reserve first; loading the route converts reserve → sale.

## What Phase 1 ships

- Schema + comments
- Pure math helpers and unit tests
- Admin Inventory page labeled Phase 4

No warehouse workflow UI yet.
