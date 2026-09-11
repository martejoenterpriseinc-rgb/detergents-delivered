# Build and release candidate — September 11, 2026

Status: build advances are committed; hosted deployment and Go Live acceptance remain incomplete. Stripe setup is explicitly deferred by the owner until application construction is complete. No provider configuration, transaction, or live activation is asserted by this checkpoint.

## Verified application increments

| Increment | PR | Full CI | Tests |
| --- | --- | --- | --- |
| Refund settlement, compensation and reward/referral adjustments | 37 | 114 | 464 |
| Reward-only refund controls | 38 | 118 | 471 |
| Quarterly subscription consent and controls | 39 | 119 | 484 |
| Rolling delivery booking window | 40 | 120 | 490 |
| Quarterly cycle preparation and customer-reviewed checkout | 41 | 122 | 497 |
| Staff cash refund preparation, guarded submission and reconciliation | 42 | 123 | 501 |
| Scheduled refund reconciliation | 43 | 124 | 504 |
| Provider report matching for refund tax evidence | 44 | 125 | 512 |
| Catalog draft import and catalog/stock export | 45 | 127 | 523 |
| Scoped customer connections and commerce gateway | 46 | 128 | 531 |
| Read-only retained-record verification | 47 | 130 | 532 |
| QuickBooks company authorization and encrypted connection lifecycle | 48 | 131 | 543 |
| Company-scoped expense account mapping | 49 | 133 | 548 |
| Protected expense posting and read-only recovery | 50 | 134 | 555 |
| Scheduled expense reconciliation and token refresh | 51 | 135 | 558 |
| Delivery SMS consent | 52 | 136 | 569 |
| Delivery SMS outbox and preference consistency | 53–54 | 139 | 580 |
| Original FIFO cost review and account mapping | 55 | 140 | 592 |
| Guarded cost journals and read-only reconciliation | 56 | 141 | 600 |
| Company customer and product links | 57 | 142 | 607 |
| Original sale, refund-tax and reward source review | 58 | 143 | 610 |

Counts are cumulative tests for each source revision, not separate tests to add together. Each full CI includes lint, typecheck, schema validation, migration replay, production build, native PostgreSQL and browser checks. Synthetic provider responses prove application behavior and are not real provider acceptance. The latest reviewed mapping and expense-export browser screenshots cover desktop, tablet and mobile.

Expense posting revision: `de7ade81b2a6e6693d1a613386ac1893f2be2f71`, tree `bf34ce3ea89a0ccf3181de70496170b50c8e0729`. CI run `34646458061`: 305 unit, 194 PostgreSQL integration, 56 browser checks.

PR 51 adds scheduled QuickBooks reconciliation and system-audited token refresh at `279a2831f1a56fadc81a871a71b8e443bf5958da`, tree `dc488e6028c71d2210e2c4ba937d8cc7c08de0df`. CI 135, run `34647478435`, passed 305 unit, 197 PostgreSQL and 56 browser checks (558 total), plus lint, typecheck, migration replay and production build. Hosted deployment is still pending.

Latest fully verified candidate in this checkpoint: PR 58, source `cf8810a5f7094e5aecca3dc883d34c7a30b98b5b`, tree `8c468c2fbda4053a909931e245668076224b69da`. CI 143, run `34654068247`, job `103442521470`, passed 318 unit, 227 native PostgreSQL and 65 browser tests, lint, typecheck, migration replay and production build. Source-review screenshots were inspected at desktop, tablet and mobile widths. PR 53's initial browser selector failure was fixed in PR 54 and verified in CI 139; no failed run is counted as acceptance. Later CI also covers SMS on tablet.

The receipt compiler/evidence matcher is subsequent construction, documented in `QUICKBOOKS-RECEIPT-EVIDENCE.md`; it does not establish an operating receipt-posting workflow.

## Migration review

The last recorded hosted revision is `a2495c4afa459a9c258804841fa37b038ecdd828`. The candidate adds the twelve migrations below; no previously retained migration SQL is modified. These add accounting/consent/cycle evidence and scheduling metadata, and extend refund constraints to support reward-only returns. Legacy subscription rows are preserved and are not silently converted into consented quarterly subscriptions.

| Migration | SHA-256 of SQL |
| --- | --- |
| `20260916100000_refund_accounting` | `c9d990efe97c938b300e37376e3959f623c985215faa8eab5ff09bedc2e0fe4c` |
| `20260916110000_reward_only_refunds` | `cc5db776b7a5facacfeb9be939006898ebc901c45e618800cdffd62d0473bb24` |
| `20260916120000_quarterly_subscription_controls` | `d83445a6b77b463cbd6ef7e1f8379c83e17b6582a6f2c8bb4a6e0fa377ebf2ac` |
| `20260916130000_subscription_cycles` | `3797e91934ed616f49d9b8cec3c70631b41e706d3855aca707c1d12c20aceaad` |
| `20260916140000_refund_recovery_schedule` | `13a4d33158726c1fa30029c1aae6c4cbffd3bee45b8c3a96d1e328dd023b920d` |
| `20260916150000_refund_tax_evidence` | `73d21f656fc5808fe3aae67f9795ca63486b92471bc322fa3f20a7b722a756e0` |
| `20260916160000_commerce_grants` | `de7e67e8c870d5fd32e7f1d6ce4f57554a1b11ad5a949c67538c868b3016cdc4` |
| `20260916170000_quickbooks_expense_exports` | `f5aeaecda3fce2d14084e3e3a2d3a1995de795fc2b30e9d16ad7141256708e87` |
| `20260916180000_quickbooks_reconciliation_schedule` | `9f09ff3f024f6157eaea4d3bcfb4acda3958d7a53f77b88548b070dcfd1bcc35` |
| `20260916190000_delivery_sms_consent` | `4d8454908782d9a8be3e2ba21bf322dc121f0ff5ab105d6cbdd21576970646d8` |
| `20260916200000_delivery_sms_outbox` | `5b92e549bf80e10783a1649383b028dc58a9f6ab9388be9e466ab58d2e3934a5` |
| `20260916210000_quickbooks_cost_journals` | `14f6f7e557baa737caa05f41e9a1e17743ba473357c2287ac7ec7a29d508133e` |

The existing two-migration refund-foundation deployment gate remains unchanged. Do not run it as authority for this larger release. Before deployment, retain a current recoverable backup and encryption keys, quiesce web writes/workers, record the exact candidate source and migration checksums, capture the retained-record checkpoint, apply the reviewed migrations, and verify the original records before restoring traffic. The fingerprint checkpoint is comparison evidence, not a database backup. Keep Render auto-deploy off and deploy only an exact accepted revision; the service's configured main branch is older.

## Remaining build and acceptance scope

- QuickBooks cost journal posting and recovery are implemented and verified with isolated provider fixtures. Sales/refund receipt submission and compensation accounting remain implementation work; the expense and cost workflows must not be described as all accounting posting complete.
- Refund settlement tax evidence supports exact completed provider report matching. Compensation tax evidence remains unverified until an appropriate provider evidence path is implemented and accepted.
- Real payment/tax, company OAuth, email, Google login, storage and notification acceptance must use the intended configured providers. Neither mock fixtures nor saved configuration alone satisfy that requirement.
- Hosted migration/deployment, current restore proof, production owner/business setup, reviewed catalog/stock, delivery capacity, approved domain, worker health and a controlled end-to-end acceptance order are still required.

Checkout, cash-refund submission, SMS delivery, and QuickBooks expense/cost posting remain governed by their existing explicit server controls. No production account, inventory, order, reward, accounting evidence or provider acceptance is fabricated to complete launch status.
