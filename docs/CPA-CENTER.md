# CPA Center

The initial CPA Center replaces the placeholder with date-filtered expense and mileage review. It reuses the authorized finance reader and CSV exporter; there is no second ledger, new mutation, provider call or migration.

ADMIN, SUPER_ADMIN and CPA may read it. The service rechecks current account and role state. CPA write restrictions remain in the finance service. Date filters validate calendar dates, ordering and the one-year range. Detail and export links preserve that range. Totals cover all matching records, independently of source-list pagination; expenses total USD only, while other currencies remain visible in the underlying records. Mileage remains miles without an inferred tax rate or deduction.

Each source read uses the existing repeatable-read transaction. The two panels are independent reads, not a combined accounting close. Exports are fresh authorized reads, carry record IDs/revisions, and retain the existing 10,000-row bound and CSV formula protection. This page does not establish complete books, net profit, deductibility, tax filing or QuickBooks reconciliation.

Browser acceptance extends the guarded finance scenario with CPA access, exported source identity, agreement with the finance API total, invalid dates and responsive screenshots. Existing native finance tests cover currency exclusion, permissions and durable source records. Provider connections remain deferred to pre-launch acceptance.
