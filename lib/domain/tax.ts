import type { Cents } from "./money";

/**
 * TaxService — Phase 1 interface only.
 * Stripe Tax is the first planned implementation (Phase 7).
 * Calculations must be snapshotted; never recompute historical invoices.
 */

export type TaxAddress = {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export type TaxLineItem = {
  reference: string;
  taxableCents: Cents;
  quantity: number;
  taxCode?: string;
};

export type TaxQuoteRequest = {
  destination: TaxAddress;
  currency: string;
  lineItems: TaxLineItem[];
};

export type TaxQuoteResult = {
  provider: string;
  taxableCents: Cents;
  taxCents: Cents;
  currency: string;
  breakdown: Array<{
    jurisdiction: string;
    taxCents: Cents;
    rateBps: number;
  }>;
  externalId?: string;
};

export interface TaxService {
  quote(request: TaxQuoteRequest): Promise<TaxQuoteResult>;
}

export class UnimplementedTaxService implements TaxService {
  async quote(): Promise<TaxQuoteResult> {
    throw new Error(
      "TaxService is not implemented in Phase 1. Stripe Tax will plug in behind this interface.",
    );
  }
}
