# Remaining Go Live work — September 12, 2026

Owner direction: finish application construction first. Add and connect all external APIs at the end. Missing provider credentials are not a reason to pause independent application work. No checkout or outbound provider activity is enabled by this instruction.

PR 66 / CI 152 passed 674 tests, including private original customer receipts, browser printing/PDF and original-address/item/tax/reward checks. The release audit in PR 67 also passed CI 153. PR 68 / CI 156 passed 687 tests with the source-verified CPA financial ledger, private CSV and desktop/tablet/mobile acceptance. A published PR alone is not acceptance. Recent work remains ahead of the deployed revision recorded in `BUILD-RELEASE-CANDIDATE.md`.

## Finish application construction

| Work | Observed state and required completion |
| --- | --- |
| Printable customer receipts | PR 66 implements original purchase reprints/PDF without a provider call and passed exact-revision database/browser/print review. Later refund receipts remain a distinct accounting/document workflow. |
| Failed-refund corrections | Signed cash, tax and reward compensation exists locally. Provider tax compensation matching and correction of a previously posted QuickBooks refund remain unresolved. Finish the guarded correction workflow; retain original records and never infer provider tax acceptance from returned cash. See `REFUND-TAX-EVIDENCE.md`. |
| Post-delivery tipping | Earlier owner requirement remains. No tip/gratuity model, API or customer flow was found in this source audit. Implement optional decline, amount/percentage selection, original delivered-order ownership, separate payment/audit/recovery and reporting. Do not change the original purchase or refund totals. |
| Approved cash/Zelle exceptions | Earlier owner requirement remains. A MANUAL provider enum exists, but no working cash/Zelle authorization and settlement flow was found. Keep ordinary online checkout authoritative. Build explicit staff approval, evidence, duplicate prevention and the same tax/stock/reward/capacity invariants before exposing this option. |
| Actual route mileage | Saved outbound/stop/return legs exist with unknown distances. No measured planned/actual RouteLeg values are currently written by delivery operations. Implement explicit measured odometer/leg capture, corrections and separate planned/actual totals; do not infer mileage from opening Waze. Manual expense-area mileage already exists. |
| CPA sales/cost/refund reporting | PR 68 now implements and verifies the source-backed sales, promotion/reward, tax allocation, signed refund/reversal, FIFO cost and returned-stock report/export. Missing evidence stays flagged; date boundaries, permissions and whole-range totals are tested. This bounded event ledger does not replace complete financial statements, bank reconciliation or prepared tax returns. See `CPA-FINANCIAL-LEDGER.md`. |
| Final workflow and interface review | Check these remaining requirements against the full contract, keep status text current, and exercise empty/error/interrupted/concurrent flows on desktop/tablet/mobile. Test and review each completed increment before release. |

This list records concrete findings, not an invented completion percentage. Financial correction requirements that depend on a provider's actual semantics can be prepared now but cannot be declared accepted from fixtures. No requirement is removed merely because an older roadmap box is stale.

## Release preparation and business data

Integrate the tested feature chain in dependency order, preserve required review gates, record the exact release source, review all additive migration checksums, and take a current recoverable backup with retained encryption keys. Quiesce writes/workers for migration, compare retained original records before and after, then deploy the exact revision and verify restart/health. Do not deploy the older configured main branch accidentally. Keep sandbox and production resources separate.

Production also needs a verified owner account, completed business/legal setup, approved catalog/prices/photos/stock, ZIP coverage, delivery calendar, vehicle capacity and the approved domain. Existing records must be reused; no sample accounts, fabricated inventory, tax registrations or business details may be created to pass a launch check.

## Connect APIs last and perform acceptance

Connect the intended payment/tax, QuickBooks, Google sign-in, email and SMS accounts; verify the existing storage, document scanning, map and monitoring dependencies. Keep sandbox/live credentials and callbacks separate. Confirm provider behavior using controlled test identities and authorized recipient messages, then the approved production configuration. A saved key is configuration evidence only.

Exercise a complete controlled order through account approval, tax, payment, inventory, rewards, delivery, private proof, receipt, refund and accounting reconciliation. Verify scheduled jobs, failure recovery, alerts, retained photos after redeploy and current backup restore. Go Live requires the intended production deployment to pass these checks; passing local or CI fixtures is not equivalent.
