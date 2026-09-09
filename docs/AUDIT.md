# Existing requirement matrix — startup repair increment

This is an increment to the saved gap-closing audit, not a rebuild or a new full audit. The complete original specification and approved-design audit remain preserved in the Sites/saved-backend checkpoints. RENDER_REPAIR.md documents the divergent histories and their exact revisions.

| Requirement | Current result | Evidence / remaining gate |
| --- | --- | --- |
| Preserve approved design and source | Preserved; no UI replacement or migration/auth merge | GitHub main repair base 5538f90; saved backend 5a34c8a; Sites unchanged |
| Reproducible startup | Implemented in review branch | Lockfile, Node pin, runtime validator; local build/unit checks pass; Node 22 CI passes at cc1bed8; latest PR checks retain this gate |
| Repair existing hosted app/database | Blocked by secure connection/internal inspection | Missing DATABASE_URL on failed deploy; read-only Render connector query failed; no hosted mutation |
| Migration preservation and review | New read-only preflight; SQL unchanged | Checksum/order/failed-history tests; native PG16 migration/replay passes at cc1bed8; hosted schema unverified |
| Safe administrator setup | Default password/implicit creation removed | One-time opt-in, transactional bootstrap, no reset or takeover; native/bootstrap and separate-session browser tests pass at cc1bed8 |
| Persistent server-side permissions | Roles and deletion refreshed on session reads | Unit mocks pass; separate browser sessions/revocation tests pass at cc1bed8 |
| Readiness and failure reporting | /api/ready fails closed | Mock HTTP response tests pass; native/runtime probe passes in both browser projects |
| Vendor → PO → receiving → catalog | Existing GitHub services retained, not fully accepted | Existing receiving tests retained; request idempotency/PO races/valuation/audit atomicity need gap-closing |
| Approved verified accounts → address/zone/week/day → immediate payment/tax → booking | Not accepted | Public signup/demo screens are not verified account approval or real checkout; provider and transaction gates remain |
| Driver queue → navigation → private photo → customer completion | Not accepted | No real connected driver/photo/customer proof from startup tests |
| Quarterly subscriptions, receipts/tips, planned/actual route legs, reports | Prior requirements retained; not completed by repair | No deferred payment option or claimed provider simulation introduced |
| Production launch | NO LAUNCH | Full acceptance, reconciliation/recovery and explicit owner approval required |

Exact evidence: [CI run 34254362585](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34254362585) — 16 native integrations, 2 browser cases. Final review adds three unit cases (104 local passes); PR #12 retains the complete test gate. The 24 approved Sites regression tests also pass. Hosted connection and full commerce acceptance remain unverified.

## September 9 account/support increment

The historical startup evidence above is superseded operationally by PR #12's hosted record: corrected startup/readiness passed at `0da05682`, and owner-provided screenshots show a shared Customer/Super Admin login. They do not prove checkout or commerce readiness. Preserve the documented initial migration deviation in PR #12.

| Requirement | This increment | Evidence / remaining gate |
| --- | --- | --- |
| Edit customer info and created dates | Database-backed name/phone, read-only original dates; identity/roles preserved | Native + desktop/mobile persistence tests passed at 7c6d29f; staging deployment pending |
| Change password | Current-password verification, throttle, session revocation, atomic audit | Native password and separate-session desktop/mobile proof passed at 7c6d29f |
| Notification on/off | Saved email/SMS preferences, default off | persistence tests; actual providers/verification remain disconnected |
| Contact us / order problem | Account-owned tickets tied to an owned order or general account question | Ownership/idempotency/rollback/native and desktop/mobile tests passed at 7c6d29f |
| Staff support dashboard / clickable KPI | Active total plus status drilldowns, lookup/filter/sort/pagination/CSV | Staff/foreign-user denial, filtered export and browser assertions passed at 7c6d29f |
| Delivery status | Real owned order/route read model; labeled planned arrival | customer browser fixtures; driver/private-photo provider workflow remains unaccepted |
| Loyalty Club display | Honest prelaunch display | no rewards engine or invented membership |
| Full commerce / production | NO LAUNCH | existing payment, inventory, scheduling, provider, recovery and acceptance gaps retained |

Migration, security review, test scope and staging approval requirements: ACCOUNT_SUPPORT.md.

Validated account/support implementation: [CI 34296706230](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34296706230) at `7c6d29f351e683f65ae3d1bda8edc7c27b7bcafb`: 109 unit/HTTP, 23 native PG integrations, 4 browser cases and all build/migration gates pass. Exact [artifact](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34296706230/artifacts/10083442163) and security/recovery review are documented in ACCOUNT_SUPPORT.md. Hosted verification and production remain gated.

## Loyalty / delivery widget / owner entry increment

Extends PR #13 without replacing its tested account/support work. See LOYALTY_DELIVERY.md for boundaries and review. Final exact revision and CI evidence are recorded in the new incremental PR.

| Requirement | Implemented in review | Remaining acceptance |
| --- | --- | --- |
| Owner default admin; View as customer | Persistent-role sign-in destination, same-identity household view, return to admin | Hosted deployment/owner confirmation |
| Live colored delivery widget; matched loyalty tile | 15-second owned-status refresh, focus/reconnection, stale/failure indicator, equal tile sizes | Driver transition/photo/ETA provider integration |
| Loyalty balance / referral links / statuses | USD ledger, held/earned balance, invitation/claim/copy/share history, customer ownership | Public email verification and provider sends are unconnected |
| Admin loyalty controls / KPI | Program rules, pause, snapshot terms, full referral/ledger drilldowns, staff-only review | Automatic verified payment award/reversal worker |
| Apply rewards / remaining balance | Catalog-owned preview and internal atomic hold/use/release helpers | Actual payment/tax/stock/capacity finalization and confirmed checkout notice; no live spending claimed |
| Financial safety | Cents, locking/idempotency, audit rollback, immutable entries and qualifying-referral reversal | Redemption refund allocation/restoration and provider reconciliation |
| Production | NO LAUNCH | Full commerce acceptance and owner approval |
