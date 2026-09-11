# Receipt submission and recovery

Receipt drafts can be submitted once by authorized finance staff when both server controls are enabled for the exact configured company:

- `DD_QBO_RECEIPT_POSTING_ENABLED=true`
- `DD_QBO_RECEIPT_POSTING_COMPANY=sandbox:<realm>` or `live:<realm>`

Both are off/unset by default. These controls authorize the application's posting path; they are not proof of provider acceptance or authority to declare Go Live. CPA users retain read-only access.

Before the claim, the service rereads current US/USD/sales-tax preferences, the active USD bank-type clearing account, the customer and each non-inventory/service item's original income-account relationship. Income-account reads are deduplicated and item checks use batches of at most five. It then rechecks connection authority, the original source and saved mappings under the order lock. Sale drafts with changed settings require re-preparation; refund drafts retain and verify their posted original sale's mappings. A refund already failed/canceled/compensated before submission is blocked.

The SUBMITTING state and audit commit before the single provider POST. The fixed endpoint, strict payload and document/entity prefix prevent arbitrary provider operations. There is no automatic POST retry. A timeout, rejection, mismatched receipt or confirmation-audit failure holds the export as UNKNOWN. The UI disables another submission after a failed response until the server state is reloaded. A held export can be checked through an exact entity/document lookup with at most two results; only one receipt with matching customer, account, destination, net lines, cash and original tax can confirm it. Provider identifiers and timestamps remain immutable. This is an accounting record operation, not a new Stripe charge or cash refund.

The existing accounting worker performs fair, bounded read-only recovery: up to ten due receipts per run, uncertain entries at one-minute intervals and posted entries at one-day intervals. It refreshes near-expiry authorization through the existing private worker capability, checks the lease, retains uncertainty in the attention count and never submits a draft. Missing/ambiguous/changed evidence stays blocked. If a refund fails after its accounting receipt was posted, successful receipt reconciliation continues to flag `REFUND_COMPENSATION_REVIEW`; a matching original receipt does not resolve the required compensating adjustment.

The original tax total is preserved and checked, but total matching alone does not establish tax-agency allocation acceptance. Verify the intended company's sales-tax behavior, refund clearing-account behavior and agency reports through controlled provider acceptance before enabling operational posting. Compensation tax evidence and downstream compensation accounting remain separate work; this implementation does not silently create an offsetting sale or erase an original refund.

Tests use isolated databases and explicitly synthetic source/provider adapters. They cover claim concurrency, failed claim/confirmation audit, lost responses, read-only worker recovery, changed mappings, ambiguous receipts, changed tax and late refund failures. Desktop/tablet/mobile acceptance covers the submission hold and subsequent receipt lookup. No hosted configuration, provider transaction or launch acceptance is performed merely by building this feature.
