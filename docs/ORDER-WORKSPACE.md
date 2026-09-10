# Orders workspace

The staff Orders page replaces the placeholder with searchable, paginated records and individual order detail pages. ADMIN and SUPER_ADMIN can open existing payment reconciliation and delivery tools. CPA can read orders. Every service call checks the current account and roles.

Search covers order number, customer name/email and the purchased SKU snapshot. Dates refer to order creation in America/Chicago, including daylight saving transitions. Pages contain at most 50 records; counts cover the full search/date result. Currency is shown explicitly, and unlike currencies are never combined into a dashboard total.

Detail pages use saved item prices, discounts, taxes, names and SKUs. They show saved delivery addresses, recorded refunds, provider event verification, tax snapshots, routes and the latest 100 delivery attempts. Raw provider payloads, checkout snapshots, session identifiers and private proof image URLs are excluded from responses. FIFO cost is shown only when consumed allocations cover the purchased quantity; it is calculated from allocation costs, not rounded unit averages.

Order status alone is not a claim of verified payment. The page does not offer a manual paid-status setter. Reconciliation uses the existing authoritative checkout service. No refund initiation, stock return, reward reversal or subscription management is implemented by this increment.

Validation includes filter unit tests, isolated PostgreSQL tests for permissions, historical data, pagination, Chicago dates and nonmutation, plus desktop/tablet/mobile browser acceptance. Database tests refuse hosted targets. Browser fixtures use synthetic accounts and do not contact Stripe.
