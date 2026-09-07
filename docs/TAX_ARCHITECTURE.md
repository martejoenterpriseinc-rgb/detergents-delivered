# Tax architecture

Destination-based sales tax for local delivery. Historical invoices must keep the tax that was quoted at checkout — even if rates change tomorrow.

## TaxService

`lib/domain/tax.ts` defines the interface:

```ts
interface TaxService {
  quote(request: TaxQuoteRequest): Promise<TaxQuoteResult>;
}
```

Phase 1 ships `UnimplementedTaxService` so checkout cannot accidentally “guess” tax. Callers must fail closed until Stripe Tax is wired.

Inputs: destination address, currency, line items (taxable cents + quantity + optional tax code).

Outputs: provider name, taxable cents, tax cents, per-jurisdiction breakdown (cents + rate in basis points), optional external id.

## Stripe Tax first

Phase 7 implements `TaxService` with Stripe Tax (test mode in staging). Reasons:

- Matches Stripe Payments already planned for checkout
- Handles destination nexus calculations we should not hardcode
- Returns a calculation id we store on `TaxCalculation.externalId`

We may add a second provider later; the order row still points at one snapshot.

## Snapshots

`TaxCalculation` is 1:1 with `Order` and is immutable. Fields:

- `destinationJson` — the address actually used
- `taxableCents`, `taxCents`, `currency`
- `breakdownJson` — jurisdictions as returned
- `provider`, `externalId`, `createdAt`

Checkout sequence (future):

1. Quote via `TaxService`
2. Persist snapshot
3. Persist order totals from the snapshot (not a second computation)
4. Capture payment for `totalCents`

Refunds do not edit the snapshot. Partial refunds may need a new calculation for the refund document; the original order snapshot stays.

## Destination-based

Tax is based on the **delivery address**, not the warehouse and not the billing card ZIP, unless law requires a different rule (documented exception). Zone membership for routing is unrelated to tax jurisdiction.

Never use `price * 0.07` in application code.

## What Phase 1 does not do

- No live Stripe Tax API calls
- No hardcoded rate tables
- Admin **Taxes** page is a Phase 7 placeholder
