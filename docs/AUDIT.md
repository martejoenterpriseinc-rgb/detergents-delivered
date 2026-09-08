# Existing requirement matrix — startup repair increment

This is an increment to the saved gap-closing audit, not a rebuild or a new full audit. The complete original specification and approved-design audit remain preserved in the Sites/saved-backend checkpoints. RENDER_REPAIR.md documents the divergent histories and their exact revisions.

| Requirement | Current result | Evidence / remaining gate |
| --- | --- | --- |
| Preserve approved design and source | Preserved; no UI replacement or migration/auth merge | GitHub main repair base 5538f90; saved backend 5a34c8a; Sites unchanged |
| Reproducible startup | Implemented in review branch | Lockfile, Node pin, runtime validator; local build/unit checks pass; Node 22 CI pending |
| Repair existing hosted app/database | Blocked by secure connection/internal inspection | Missing DATABASE_URL on failed deploy; read-only Render connector query failed; no hosted mutation |
| Migration preservation and review | New read-only preflight; SQL unchanged | Checksum/order/failed-history tests; native PG16 migration/replay CI pending; hosted schema unverified |
| Safe administrator setup | Default password/implicit creation removed | One-time opt-in, transactional bootstrap, no reset or takeover; native/browser proof pending |
| Persistent server-side permissions | Roles and deletion refreshed on session reads | Unit mocks pass; separate browser sessions/revocation tests in CI pending |
| Readiness and failure reporting | /api/ready fails closed | Mock HTTP response tests pass; native/runtime probe pending |
| Vendor → PO → receiving → catalog | Existing GitHub services retained, not fully accepted | Existing receiving tests retained; request idempotency/PO races/valuation/audit atomicity need gap-closing |
| Approved verified accounts → address/zone/week/day → immediate payment/tax → booking | Not accepted | Public signup/demo screens are not verified account approval or real checkout; provider and transaction gates remain |
| Driver queue → navigation → private photo → customer completion | Not accepted | No real connected driver/photo/customer proof from startup tests |
| Quarterly subscriptions, receipts/tips, planned/actual route legs, reports | Prior requirements retained; not completed by repair | No deferred payment option or claimed provider simulation introduced |
| Production launch | NO LAUNCH | Full acceptance, reconciliation/recovery and explicit owner approval required |
