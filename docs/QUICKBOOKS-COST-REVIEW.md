# QuickBooks cost review and account mapping

Build increment: source review and mapping only. No JournalEntry is submitted by these actions, and no real-company acceptance is claimed.

The existing Reports → QuickBooks workspace now lets finance staff review paid-order cost evidence, select a recorded stock return, and map the intended company's active USD Cost of Goods Sold and Other Current Asset accounts. Administrators confirm and save mappings; CPA access is read-only. Mapping writes retain version checks, request replay protection, current connection authorization, company binding and an atomic audit record. Provider reads use the existing bounded QuickBooks client; there are no provider writes in this increment.

Sale cost comes from the original consumed CheckoutCostAllocation quantities and integer-cent unit costs, with each allocation matched to the purchased variant and quantity. The source must have a placed date, a paid checkout in the current environment and matching verified Stripe payment evidence. Current purchase prices, changed inventory-layer prices and rounded averages are not used to recreate history.

For a return, all recorded return evidence is checked against the original allocation identity, layer, variant, unit cost and remaining returnable quantity. Only SELLABLE quantities restore inventory cost; DAMAGED quantities consume return capacity without increasing the inventory asset. A fully damaged return has zero restored cost. Reviewing returns does not issue a refund or alter the original sale cost. Dates use the existing America/Chicago business-date convention. Source reads use a read-only repeatable-read transaction.

Bounded source review accepts at most 100 order items, 500 cost allocations and 500 return lines, with an aggregate cost ceiling of $1,000,000. The screen pages through paid orders and company accounts and preserves choices and the request key after interrupted mapping saves. Changing an order or return removes the previous cost preview.

Validation includes integer-cent domain limits; isolated PostgreSQL sale/return evidence, finance permissions, environment rejection, mapping concurrency/replay, stale versions, wrong currency, lost authorization and audit rollback; and desktop/tablet/mobile browser flows with explicitly synthetic provider responses. These tests do not prove a real QuickBooks company accepts accounting entries.

Remaining: immutable journal export preparation, a durable one-attempt provider submission claim, exact receipt reconciliation, scheduled monitoring and controlled real-company acceptance. Sales/refund exports also remain separate work. No new database migration is required by cost review or mapping.
