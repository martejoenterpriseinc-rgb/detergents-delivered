# Scoped commerce gateway

Customers manage application connections in Account → Connected apps. Email verification, explicit consent, selected scopes and a 1–7 day expiry are required. At most five unexpired unrevoked connections and ten new connections/hour are allowed. A 256-bit access key is shown once and stored only as a SHA-256 digest. Consent and key identity are immutable. Revocation is permanent; password/session-version rotation and deleted/unverified accounts invalidate access.

The protocol-neutral JSON API advertises capabilities at GET /api/commerce/v1. Public catalog pages use GET /api/commerce/v1/catalog with optional q/cursor, with 50-row pagination and an explicit DTO that omits raw inventory, private media and provider fields. Coverage and policy links use the existing public application routes.

POST /api/commerce/v1 requires Authorization: Bearer <key>, JSON and an allowed origin when an Origin header is supplied. Cookies cannot authorize this endpoint. Actions:
- orders.list: orders.read; own orders and fulfillment summaries, 50-row cursor pagination.
- subscriptions.list: subscriptions.read; own schedules and items, bounded to 100.
- rewards.balance: rewards.read; existing reward ledger/reservation calculation.
- addresses.list: quotes.create; own approved address choices, bounded to 50.
- quotes.create: quotes.create; the existing strict checkout input inside quote.

Grant use is serialized and bounded to 60 requests/minute. Scope, environment, owner, expiry, revocation and current account/session state are checked. Quotes use the existing price, stock, promotion, rewards, tax, address, capacity and consent checks. Grant authorization is rechecked within the customer lock after tax I/O, before a quote is saved. Revoking during tax lookup prevents the pending quote write.

The gateway cannot charge, reserve inventory or change subscriptions. A prepared quote links to the customer-authenticated /checkout/review/:id page, which uses the existing ConnectedCheckout component and payment endpoints. The customer must review the amounts and explicitly accept the delivery/payment terms. No second payment pipeline is introduced. Revoking application access does not erase a customer's already prepared quote or existing orders.

Migration 20260916160000_commerce_grants adds persistent consent/rate records and an immutable-identity/revocation trigger. No hosted migration/deployment or real provider acceptance has occurred. All acceptance records in CI are synthetic; Stripe setup remains deferred.
