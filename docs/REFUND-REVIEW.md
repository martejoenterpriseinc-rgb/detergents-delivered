# Order refund evidence review

Adds an explicit Check refunds with Stripe action to verified Stripe payments in the order workspace. Admin, owner and CPA users may inspect; customer accounts cannot. The POST boundary checks authentication, origin, JSON size, exact order/payment binding and strict input fields. Responses are private and uncached.

The service reads the original paid checkout, verified payment event and saved refund requests in a read-only repeatable-read transaction. It releases the transaction before Stripe I/O, then rechecks access and the full local snapshot. Concurrent local changes cause a retry message instead of returning stale results. The existing provider adapter checks account/mode/payment/capture identity and complete bounded refund history; external, duplicate and mismatched refunds fail closed.

The result contains only checked time, currency, aggregate provider amounts/counts, dispute flag and counts of changed/unconfirmed requests. No payment identifiers, raw provider payloads, customer banking instructions or metadata are sent to the browser. Rechecking clears prior results, including when the new request fails.

This is a point-in-time inspection, not a settlement or authorization to submit refunds. No database records, stock, rewards, tax, balances or provider state are changed. Unknown submissions remain unresolved even if no corresponding provider refund appears. The existing refund submission, settlement/reversal, reward and tax work remains outstanding.

Validation includes route security/error-redaction unit tests, native PostgreSQL authorization/read-only/concurrent-change tests with a mocked provider, and desktop/tablet/mobile UI response/error checks with explicitly simulated API responses. These do not establish real Stripe acceptance. No migration is required.

Provider lifecycle reference reviewed September 11, 2026: https://docs.stripe.com/refunds
