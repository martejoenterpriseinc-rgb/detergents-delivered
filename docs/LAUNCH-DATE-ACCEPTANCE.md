# Launch-date acceptance — September 9, 2026

Scope: make the retained launch date configurable and persistent, publish approved source and deploy staging only. Production/DNS/live payments remain untouched.

## Source history

Git command-line authentication was unavailable. The connected GitHub integration published ordered commits, preserving the existing remote ancestor and verifying each source tree SHA against local Git. The local branch remains intact. No forced ref update occurred. One duplicate tree-only publication preceded the lock-fix commit; it changed no files.

- Local `21e9c8ad9854cbcef1d224c33bb5c7942115fbea` → published `4e7e060dd901f03fb261879a894b4c8c69d17e9d`; tree `ab307a9d62241335bd46b89361fdcbd4b20c5643`
- Local `4bc34ec00bfa5c4c3f87c3b0253fe65317630f3c` → published `79f70cfc72a421e27537576e1875ff64b5064df6`; tree `28637776ff64ab1ec054157e9903cf899c5c2bda`
- Local `319a8e64ad08f9bdc4807f5e1cbe639f0d1f24d2` → published `955628e0f862b9f161c311639b5a4b251933be10`; tree `708e01b5a22afcaae640cae39553263b5e1825f2`
- Local `6f2148a947fa6b2f384cedb8b29dbead68a1fab0` → published `712429c8357e4d30cd545bc85ad337ecc21c252c`; tree `366dbcddb3cb7481f0969638d0aed8c0034362d6`
- Local `6f2148a947fa6b2f384cedb8b29dbead68a1fab0` → published `fc87221b5b04f20e20a7c7781947e231f4d5e306`; tree `366dbcddb3cb7481f0969638d0aed8c0034362d6`
- Local `b32920550513229a11e8be8a9bb8bca6f2c8e730` → published `9ce7bb1211bd2d060004c5979436120ebcca5677`; tree `7120a81cc8a8254b702c8f1d17eee2a55fd7a4f5`
- Local `34bbb834b4ac01e31bb41080cab31bb842cbec3c` → published `d17323f6883107fd6afacf1a76c66850692d93db`; tree `a062555f7ecbd1f4066f0e9006fcb70669279ffb`
- Local `1d8cda4cfd82ffc2fce66d5b4120b9b24eb4b00b` → published `82a55645e8ea29b59e195b1d6304b39a631517c7`; tree `e68452634c8cb9b240aa433de9df321fcc09c684`
- Local `7be0cd43b817f1f733347188fd642b36504df63a` → published `77ecd253796e1d3439f7bcf2e17d0b8d9f29a531`; tree `d1e3846c003fcbcf5c7744b448854400100df2cd`
- Local `9c2fe8c386a5af103d324df77872e8c5b03265c4` → published `ce37bcd54a43a096495e5c4341c9c06e4b35a806`; tree `f355af362f808260005a4c94a82641da652d7278`
- Local `9accfbccfbbf9805c441599d330042dd1a69a6b2` → published `b986ee320d857cc47e6656b3007bb079d02980cf`; tree `cec81fa8c73a4b8620782513d9e425da145b87a0`

- Local `7237924682000470e64cb543d3903f827f887210` → published `403ce290f47e1959a56f9def1825e693b68f8dbc`; tree `f4a3b6684d60e58ec8f118a30414fb0433b6e802`

## Verification record

- PR15: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/pull/15 (draft; no merge).
- CI40 found Prisma could not decode PostgreSQL void results from advisory lock SELECTs. Changed calls to executeRaw, retaining transactional locks.
- CI42: all 138 unit and 38 native PostgreSQL tests passed, with all eight migrations applied/replayed and optimized build passing. Browser cases exposed outdated labels, a login synchronization error and mobile overflow. These were corrected without skipped tests or lowered thresholds.
- CI44–46 narrowed the remaining failure to mobile customer-directory overflow. The accessible Edit label was absolutely positioned outside the table scroller. Positioning the scroller contains that label; broad root clipping workarounds were removed.
- **CI47 passed** at published `b986ee320d857cc47e6656b3007bb079d02980cf`: 138 unit tests, 38 native PostgreSQL integrations, all 10 desktop/mobile browser cases, lint/typecheck/optimized build and all eight migrations applied/replayed. No skipped cases, forced clicks or lowered thresholds. Strict mobile root/viewport/scroll widths now match the device before and after screenshots, and real KPI clicks complete the workflow.
- Exact run: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34355822123 ; job 102480103998.
- Browser artifact 10105845367: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34355822123/artifacts/10105845367 (114,882,239 bytes, 14-day GitHub retention). Screenshots, traces, report and database assertions cover real synthetic Auth.js/PostgreSQL sessions. Invalid photo bytes and injected HTTP 503 saves are explicit failure tests; local development storage and fixture payment states are not cloud storage or Stripe sandbox acceptance.
- Before migration, staging preflight reported six applied migrations, 55 tables and no history problems; only delivery_operations and launch_offers were pending.
- Read-only preservation baseline: 54 application tables, 34 existing rows. Stores original column names and row hashes privately on staging; no raw customer data emitted.
- Fresh staging recovery export completed September 9 at 12:41 UTC; seven-day point-in-time recovery displayed. No restore exercise performed.

## Launch behavior

Launch, cutoff and first-delivery dates are validated and saved in commerce.launch with a revision check and atomic audit. The form displays the confirmed saved date and marks unsaved changes. Native tests cover concurrent saves and reject unauthorized/invalid date changes. Browser tests change the initial date, assert the stored date/revision, refresh, and inject a labeled HTTP 503 to verify the last saved date survives without false success.

Saving this configuration does not enable payment or place delivery reservations. Existing paid bookings remain fixed. Launch ordering, provider tax/payment, verified account/address onboarding, protected checkout reservations and hosted private storage remain open acceptance gaps.

## Staging migration acceptance

At 13:19 UTC on September 9, both reviewed additive migrations were applied only to `detergents_delivered_staging_db`. Preflight reports current: 58 tables, eight completed migrations, no pending migrations or problems. Original columns and row hashes remain unchanged across all 54 original application tables and 34 rows, checked immediately before and after migration. No synthetic CI fixtures were loaded into staging.

- delivery_operations SQL SHA-256: `abc19ff6977a237fd21672314b404d2b173a790e3f3cc9ee72cf63f1be9f9214`
- launch_offers SQL SHA-256: `9ebb515a05c8021d3b3c7e1184a3bae4dd6b1848fc1cc539adb67410f659007d`
- Exact-commit staging deployment requested: `dep-daglpnh42hec73ctajlg`, source `b986ee320d857cc47e6656b3007bb079d02980cf`. This deployment became live at 13:22:27 UTC; runtime and database preflight passed.

## Hosted launch-date proof

The existing authorized owner session opened `/admin/settings/launch`, saved the October 15 draft and saw `Settings saved. Existing bookings have not moved.` Reload and a separately opened browser tab both showed `Saved launch date: 2026-10-15`.

A guarded read-only PostgreSQL query from the deployed service verified:

```json
{"launchDate":"2026-10-15","cutoffDate":"2026-10-14","firstDeliveryBy":"2026-10-31","version":1,"plannedWindowEnabled":false,"savedAuditCount":1,"readOnly":true}
```

No checkout/payment activation, cadence assignment or customer/booking edits occurred. The date is an editable staging draft, not a production launch announcement. Screenshot review found the calendar heading still called a saved configuration an “unsaved preview”; a one-line label correction changes it to “cadence preview”, leaving the explicit unsaved-changes indicator and all save logic intact.

## Current requirement matrix

| Requirement | Accepted evidence | Remaining boundary |
|---|---|---|
| Editable saved launch/cutoff/deadline | CI47 changed-date/revision assertions, desktop/mobile refresh and explicit HTTP 503 recovery; hosted owner save, second-tab persistence and PG audit/date query | Date does not enable purchases or reserve deliveries |
| Area weeks/day/vehicle and capacity | Native locks, stale saves, ZIP collisions and paid-booking capacity protection pass in CI47 | Read-only demand proposals; checkout must still finalize capacity transactionally |
| Shop entry and savings | Native atomic creation/idempotency and browser creation/refresh pass | Hosted image storage, verified purchase approval and connected payment checkout remain closed |
| Admin KPIs/customer directory/queue | All desktop/mobile scenarios pass, including mobile overflow, click-through/filter/export/edit and interruption recovery | Map coordinates must be validated; Waze is handoff only; no traffic ETA claimed |
| Private completion photo | Native ownership/failure/replay and separate customer/friend browser sessions pass against development adapter | Hosted route start/photo upload remains gated until durable private storage is connected |
| Support and loyalty/promotion controls | Existing and new regression/native/browser cases pass | SendGrid/Twilio delivery, Stripe/tax and final reward spending/refunds not accepted |
| Production isolation | Guards remain; no test fixtures copied to staging or production | Production resources, complete commerce acceptance and explicit launch approval still required |

**Launch verdict: NO PRODUCTION LAUNCH.** Staging date persistence is accepted. Build logs also retain an existing standalone-output/start-command warning and npm dependency audit findings; resolve those in the deployment-hardening increment before production acceptance. No claim of real provider sandbox testing is made.

## Final wording revision acceptance

CI48 at `403ce290f47e1959a56f9def1825e693b68f8dbc` passes the same complete 138-unit / 38-native-PostgreSQL / 10-browser gate, with all build, lint, typecheck and migration checks. It differs from the accepted staging source only in the calendar heading: “cadence preview”.

- Run: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34356827600
- Job: 102483520006.
- Artifact: https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34356827600/artifacts/10106252743 ; 112,906,354 bytes; SHA-256 `036b0e331dc01ff965109443213d1ec5d12cdba7e823e546af3a25b31a0abe3a`; GitHub retention 14 days.
- Exact-commit staging deployment: `dep-daglu1uk1f9s73dgbta0`; no further migration or configuration change.

Final deployment became live at **13:31:11 UTC** on September 9. A fresh server-side page load showed the corrected “Monthly calendar — cadence preview” heading and `Saved launch date: 2026-10-15`. The final instance reports Git HEAD `403ce290f47e1959a56f9def1825e693b68f8dbc`; a repeated read-only database query returned the same date, version 1, disabled public window and one saved audit record. This proves persistence across deployment as well as refresh. The final browser screenshot is `detergents-delivered-launch-saved.jpg`, delivered with this handoff.

These final documentation updates do not change the deployed runtime or database. CI48 is the acceptance run for the exact deployed application commit; subsequent documentation-only CI must not be confused with a different runtime deployment.
