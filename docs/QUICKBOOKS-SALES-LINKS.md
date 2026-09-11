# QuickBooks customer and product links

This increment prepares sales/refund mapping; it does not submit sales or refund receipts. It reuses the existing QuickBooks company authorization and Reports workspace. No new provider records are created and no existing customer, catalog or inventory data is overwritten.

Administrators select an application household or product variant, choose the matching active record in the intended company and explicitly confirm the link. Customers must use USD. Product links accept NonInventory or Service items without quantity tracking and require an active USD Income account. Inventory items are blocked because inventory and FIFO costs are controlled by this application and cost journals; automatically tracking the same quantities in QuickBooks would duplicate that responsibility.

Links are scoped by environment, company, record kind and application ID. Version checks prevent stale overwrites, hashed request IDs preserve retries, and each save commits with its audit record. Within a company, one QuickBooks customer/item cannot be linked to two application records, including concurrent requests. A company/kind advisory lock serializes uniqueness checks. Existing mappings can be changed only through another confirmed versioned save; future receipt drafts must retain their original mapping snapshots.

CPA users can inspect links and bounded provider choices but cannot save. Provider responses are projected to identity/display name, active/currency or item type/income reference; balances, email/address and purchase-cost fields are discarded. Source customer identity is shown only to authorized finance staff. Reads page through 50 application records and 100 company records. The screen caps accumulated choices at 500 application and 1,000 company records and preserves the chosen source, target and request key after a failed save.

Tests cover native mapping replay/concurrency, two-household conflicts, stale versions, lost authorization, company changes, currency, item quantity tracking, income-account validation and audit rollback. Browser tests use synthetic provider responses on desktop/tablet/mobile. No real QuickBooks acceptance is claimed.

No migration is required. Remaining sales/refund work: immutable original financial/tax source review, clearing-account and tax configuration, protected SalesReceipt/RefundReceipt submission and exact receipt reconciliation. Tax amounts must come from the original Stripe snapshot and matched refund evidence; do not infer tax from current catalog settings or fabricate an external tax match.

Provider fields were checked against Intuit's official SDK Item definition: https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPItem.php. The existing fixed-host API client performs bounded reads with timeouts, no redirects and no token disclosure.
