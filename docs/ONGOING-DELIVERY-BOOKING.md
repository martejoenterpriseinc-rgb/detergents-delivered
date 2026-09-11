# Ongoing delivery booking

Ongoing booking is an explicit saved setting under Launch & Capacity. Existing settings without `rolling` remain launch-only; no configuration is enabled automatically. Launch display/booking, checkout activation, account verification, address approval and provider readiness remain separate requirements.

Before the launch cutoff, checkout retains the approved first-delivery window. Between cutoff and launch day, ordering remains closed. On or after launch day and after cutoff, an enabled ongoing policy offers dates from the current Chicago business date plus the saved lead time through the saved horizon. Lead time is 1–30 calendar days, horizon is 7–90 days and must exceed lead time.

The existing locked zone cadence supplies candidate dates. The same authoritative checkout checks current prices, promotions, rewards, stock, FIFO layers and shared vehicle capacity. It rejects empty cadence windows. A setting change or date rollover requires an unreserved quote to be reviewed again; already reserved and paid promises retain their saved window and date.

The public account/ZIP eligibility response now checks the booking window and locked cadence instead of declaring purchasing available from a launch flag alone. Capacity is finally reserved at checkout, never promised by a ZIP response. Expired planned-launch notices are suppressed.

Validation includes unit coverage for legacy defaults, prelaunch closure, leap/year boundaries and policy bounds; native PostgreSQL tests for ongoing booking capacity competition, preserved paid snapshots and stale quote rejection; desktop/tablet/mobile settings persistence and failed-save coverage. Provider tax and payment fixtures in CI are mocks. No hosted settings or provider configuration were changed.

This supplies the delivery window required by future quarterly purchases. It does not itself create subscription cycles or authorize automatic billing.
