# Scheduled QuickBooks expense reconciliation

Implementation candidate; deployment and real provider acceptance remain pending.

The existing operations worker now runs `quickbooks-reconciliation`. It refreshes an authorized company connection when its access token is near expiry and reads previously submitted expense evidence. It never prepares or submits an expense, enables posting, connects a company, or disconnects one.

The worker uses a server-only Symbol capability and system audit entries, without selecting or impersonating an administrator. HTTP write routes still require the existing staff identity, role, session, and confirmation checks. Connection changes and company/environment mismatches block reconciliation.

A run checks at most ten exports for the configured environment and company. Uncertain submissions are eligible every minute; confirmed exports are checked daily. Oldest checked records run first, with unvisited records first. The lease is renewed before provider work. Each attempt persists its check time, including failed reads, so a failing record does not monopolize a batch. No match, multiple matches, changed amounts/accounts, or changed provider identity retain the protected source and accounting link and produce a generic review issue. Persisted issues keep the operational job in Needs attention between checks.

Staff can use read-only reconciliation to clear an issue after exact provider evidence matches again. The original provider receipt, source snapshot, and posted identifier remain immutable. Token refresh uses the existing durable claim: uncertainty blocks the connection for reconnection instead of retrying the old refresh token blindly.

Migration `20260916180000_quickbooks_reconciliation_schedule` adds nullable check time/review status and a lookup index. It does not rewrite financial records or the prior expense export migration. Apply only with the complete tested release and the current record-preservation checkpoint.

Validation includes native PostgreSQL tests for recovery with posting disabled, system audits, lease rejection before network work, and token rotation without expense submission. Synthetic provider responses test behavior; they do not constitute real QuickBooks acceptance. Stripe setup remains deferred by the owner.
