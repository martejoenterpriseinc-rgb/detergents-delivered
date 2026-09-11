# Staff cash refund operations

Orders now exposes preparation of a payment refund from remaining purchased units, review of the original net/tax/reward allocation, explicit submission confirmation and separate reconciliation. CPA remains read-only. Physical stock return remains an independent receipt.

The API accepts only a saved order/request reference for submission and reconciliation; client amounts and provider observations are rejected. Existing role checks, same-origin protection and body limits apply. The service takes a durable one-time claim before contacting Stripe. A lost or failed response switches the browser to reconciliation, not another create. Server-side concurrency and retries cannot claim the same draft twice.

Cash submission is disabled by default. It requires `DD_CASH_REFUNDS_ENABLED=true` and `DD_CASH_REFUNDS_ACCEPTED_ACCOUNT` matching the effective `sandbox:acct_...` or `live:acct_...` identity, plus the existing provider configuration checks. These are operator activation acknowledgments, not evidence of actual provider acceptance. Set them only after the intended account's refund, tax, compensation and accounting acceptance has been completed and recorded. None were enabled in this build.

Reconciliation remains available after new submissions or checkout are disabled. It recovers an uncertain submission, fetches independently verified provider history and applies the existing immutable settlement/compensation/reward transaction. It never creates a new provider refund. An unmatched, disputed or conflicting outcome retains the request for review. Missing provider configuration causes an error and leaves saved amounts unchanged.

Native tests cover inactive/mismatched activation, current role denial, one concurrent claim, uncertain responses and reconciliation while creation is off. HTTP tests reject missing confirmation, money overrides and fabricated provider evidence. Existing desktop/tablet/mobile return tests cover the closed submission state and CPA exclusion. Provider responses remain mocked in CI; no real transaction or provider setup is claimed.

Provider tax evidence matching and durable scheduled refund reconciliation remain separate work. The local tax allocation is not proof that Stripe adjusted its tax records. Adding this UI does not fulfill real-provider acceptance or Go Live.
