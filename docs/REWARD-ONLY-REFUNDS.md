# Reward-only merchandise returns

Owner instruction September 11: continue building; Stripe setup is deferred until the application is built. Missing Stripe credentials must not stop independent implementation work. Checkout and payment refund activation remain closed until final provider acceptance.

For a paid purchase containing merchandise with zero cash value after discounts, staff can prepare a reward credit return from the order page, review the original allocated credit and explicitly confirm restoration. The dedicated API rejects any selection with a cash component. It requires the original verified payment, correct database environment, USED reward reservation, original redemption ledger entry and matching saved purchase allocation. No Stripe API or credential is required to restore this already-recorded local credit.

Drafts share the existing quantity reservations with cash refunds. Confirmation locks wallets, qualifying referral and order in the existing lock order, validates the original allocation again, and atomically records one immutable REWARD_ONLY adjustment, reward ledger credit, request event and audit. It leaves Payment, Refund, stock and fulfillment records unchanged. Qualifying referral awards are reversed using the same transaction. Reward-only entries are excluded from provider tax matching because no cash or tax allocation is reversed.

Retries preserve the same draft key and payload; duplicate confirmation returns the saved result. CPA access remains read-only. Cash submissions still require their distinct provider workflow; zero-value provider refunds are rejected. The UI never accepts client supplied money amounts.

The additive migration permits zero-cash requests and constrains REWARD_ONLY entries to positive original reward credit, zero cash/net/tax and no provider references. Existing positive/negative cash adjustment constraints and immutable triggers remain enforced. This migration has not been applied to hosted databases.

Validation includes native PostgreSQL concurrency, quantity limits, authority, wrong-environment and cash-selection rejection, audit rollback, no provider calls and no cash/stock/tax side effects. Browser acceptance exercises prepare, review, confirmation, lost response/retry and CPA visibility at desktop, tablet and mobile sizes. All provider/payment fixtures are synthetic.
