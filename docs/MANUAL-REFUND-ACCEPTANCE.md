# Manual cash / Zelle refunds and tax corrections

Continuation of the existing release chain, PR 83. APIs remain unconnected. No real refund,
tax transaction, QuickBooks posting, hosted migration or production deployment is performed
by building or testing this change.

## Implemented behavior

- Open Refunds / return receipts from a settled manual checkout. Prepare selected item
  quantities using original saved net, tax and redeemed-reward allocations. Active drafts
  reserve capacity. Whole and partial returns conserve every cent.
- Record money already returned through the original cash or Zelle method. Exact amount,
  unique receipt reference, returned time, evidence notes and confirmation are required.
  This screen does not send a bank transfer. Do not return money a second time after an
  uncertain save; use the same-request retry or inspect the existing receipt.
- A return receipt/event, refund, signed accounting adjustment, reward restoration,
  payment status and permanent audit commit together. Admin authorization is rechecked
  inside the transaction. Customer/CPA/driver writes are denied. Original sale amounts,
  paid tax evidence, stock, FIFO, checkout and route records remain unchanged.
- Cancel only an unused draft. A recorded return cannot be canceled as unpaid. Physical
  stock returns stay in their existing workflow and are never inferred from a refund.
- Separate manual tax reversal submission binds the original standalone Stripe Tax sale,
  account/mode, address, original tax line IDs and exact negative net/tax allocations.
  The durable claim commits before the provider create call. Staff authority and original
  evidence are rechecked after provider reads and immediately before creation. There is no automatic second
  create. Lost outcomes require an existing tax reversal ID for GET-only recovery.
- Verified reversal evidence and its audit are append-only. Money returned is recognized
  independently of provider tax evidence. The CPA and tax views use original manual sale
  evidence and the actual return date; pending tax remains explicitly unverified.
- Manual QuickBooks RefundReceipt preparation requires verified reversal evidence and
  the original posted sale in the same company with its original cash/Zelle account mapping.
  Card refund/provider IDs are never invented for manual returns. Existing QuickBooks
  posting/recovery/activation controls still apply.

## Activation

New manual refund preparation requires `DD_MANUAL_REFUNDS_ENABLED=true`; production also
requires `DD_LIVE_MANUAL_REFUNDS_ACCEPTED=true`. Existing receipts remain recordable after
preparation is disabled. Tax creation separately requires `DD_MANUAL_REFUND_TAX_ENABLED=true`
and in production `DD_LIVE_MANUAL_REFUND_TAX_ACCEPTED=true`. Leave all flags off until
controlled provider and hosted acceptance. Adding credentials alone does not activate them.

Two ordered migrations extend refund validation while retaining earlier applied SQL and
records: `20260917040000_manual_refund_receipts` and
`20260917050000_manual_refund_tax_evidence`. Replay and retained-record checks are required.

## Validation and remaining launch gates

Local typecheck, ESLint and 421 unit tests pass at the tax/evidence increment. Native tests
cover concurrent receipts, full and partial capacity, wrong methods/amounts/times, audit
rollback, source tampering, reward conservation, CPA/live gating and GET-only tax recovery.
Three-width browser coverage exercises the actual partial-return form and an intentionally
lost save response. CI must pass against the exact final source before release.

Final provider acceptance must prove supported standalone reversal responses, negative line
amount/tax evidence, actual posting dates, uncertain-response recovery, original cash/Zelle
QuickBooks clearing accounts, RefundReceipt balance/tax reconciliation and permissions in
the intended sandbox and live services. This is not proven by fixture results.

Still-open related work: failed card-refund tax compensation and QuickBooks correcting
transactions; QuickBooks dedicated tip/payout postings; manual received-funds exceptions
(expired approval, late receipt, delivery rescheduling); reviewed resolution of a tax claim
where no provider transaction was created; final provider/report acceptance and production
release. Do not treat this manual refund increment as completion of those separate gates.

## Provider reference

Stripe CLI `stripe docs api POST /v1/tax/transactions/create_reversal`, plus the installed
Stripe 22.6.1 SDK declarations, were reviewed. Reference:
https://docs.stripe.com/api/tax/transactions/create_reversal
