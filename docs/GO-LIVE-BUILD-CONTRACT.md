# DetergentsDelivered — full build and go-live contract

Status: requirements recorded; the new work in this contract is not implemented or accepted merely by committing this document.

## Authority and target

The owner confirmed on September 9, 2026:
- Continue the full DetergentsDelivered build through verified go-live.
- The application to finish is https://detergents-delivered-staging.onrender.com/ and its /admin workspace.
- Use martejoenterpriseinc-rgb/detergents-delivered as the implementation repository.
- Use the customer-facing visual direction at https://detergents-delivered-staging.joedy-martell.chatgpt.site/ as the storefront reference. The separate Sites admin mockup is not the operating application.
- Preserve the Render admin design and the consolidated navigation in PR #18.
- Extend the existing application and backend; do not create another app, separate customer database, replacement admin, or parallel checkout.

Latest inspected complete source: a1baadca113b8474a09543bf279bd0e486454267 (feature/admin-workspaces).
Its CI passed lint, typecheck, unit tests, PostgreSQL integration tests, migration replay, build, and desktop/mobile acceptance.
Render inspection returned e99feb8a9db9816de5e375a19c6cd218bb107e6c as the live staging application. Therefore passing PR #18 must not be presented as already deployed.
Existing Render service: srv-daffhfqd0e5s73c76v2g. Auto-deploy is off. Service branch is main, which is older than the manually deployed feature revision. Never call an unpinned deployment that would revert the app to the older main.
The inspected workspace tea-d9nvrlnqj5pc73fmf610 is named BidSmooth but contains this explicitly selected DetergentsDelivered service. Limit all work to the DetergentsDelivered resources; do not alter BidSmooth or Martejo.

Review active branches, newer instructions, and check results again before resuming. Preserve concurrent work. The feature chain currently runs from repair/render-database-startup through customer support, loyalty, delivery, checkout, business setup, and admin workspaces. Integrate in dependency order with existing protections.

## 1. Consolidated operating navigation

Retain these parent workspaces and functioning child actions, with existing role permissions:
- Customers: directory, Customer Support and Loyalty Program buttons, clickable source-backed customer KPIs.
- Inventory: products, categories, + Category, + Item and inventory KPI drilldowns.
- Receiving: visual saved-batch and purchase-order overview, purchase-order workflow, selectable vendors and + Vendor. Preserve unsaved PO work while adding/selecting a vendor.
- Reports: CPA Center, Import/Export, Expenses, Mileage, Taxes.
- Settings: Launch & Capacity, Integrations, Address Approvals, Business Setup and Business Documents.
- Dashboard: saved setup-completion percentage and progress; after explicit owner completion, remove its setup action/card while keeping setup and records in Settings.
Keep subordinate categories out of the main drawer. Preserve existing deep links, parent selection, authorization and mobile access.

## 2. Customer storefront

Bring the preferred Sites customer-facing design into the Render application. Preserve approved branding, layout character, clear product imagery, concise copy and working navigation.
Use real published inventory, price services, account state and delivery settings. Do not copy sample orders, mock stock, fabricated prices or browser-local business data from Sites.
Keep catalog, account, checkout and all customer links on the Render app and eventually its approved production domain.
Display login/account access clearly on desktop, tablet and mobile, without forcing mobile visitors to discover it inside the menu.
Remove developer configuration instructions from customer empty states. Empty catalog, closed ordering, unavailable service, preorder and provider failures must have plain, accurate customer messages.

## 3. Compact map driven by eligible ZIP settings

Place an attractive, restrained delivery-area section on the storefront, approximately 240–320 pixels high on desktop and sized appropriately on mobile; it must not dominate the home page.
The public coverage feed must derive from the same active DeliveryZone postal codes and backend eligibility rules used by ordering. Do not use the older hardcoded county example lists as purchasing authority.
As staff add, remove, deactivate or reassign ZIP codes, the map and ZIP list must update without code edits or redeployment. Existing open pages should refresh appropriately without disruptive jumps.
Auto-fit the geographic extent as coverage grows. Provide accessible zoom/fit controls and a Check my ZIP action.
Use verified geographic data. Never invent coordinates, use customer addresses as public markers, or imply that a whole county or an arbitrary radius is eligible.
If displaying ZIP centroids rather than actual ZIP polygons, label them as ZIP locations and keep exact eligibility in the ZIP checker. Do not paint an unsupported continuous service boundary.
Handle unmappable ZIPs, duplicate/ambiguous assignment, empty coverage, inactive zones, unavailable tiles/geocoding, changing settings while loading, distant ZIPs and mobile layouts. Map failures must leave ZIP checking available.
Keep approved coverage separate from ability to purchase right now: launch/cutoff rules, account/address verification, current delivery capacity, inventory, checkout activation and provider readiness remain server-enforced.
Show planned coverage/opening dates only when saved and approved for public display. Never advertise that checkout is open merely because a ZIP appears on the map.
Use bounded, cached geographic requests with attribution/licensing, provider timeouts, input validation, and a paginated/scalable coverage feed. Never expose private customer, route, vehicle, capacity, credential or internal operating records.

## 4. Website Builder must render the actual storefront

Replace the simplified preview cards with the same shared renderer, components, styles, typography, assets, section order and responsive breakpoints used by the public page.
Provide Desktop, Tablet and Mobile preview modes using true viewport widths (for example 1440, 768 and 390), not CSS scaling that keeps desktop breakpoints.
Include header, logo, navigation, hero, photographs, product area, benefit/feature sections, delivery map/checker, calls to action and footer in the editable homepage model. Make every supported area selectable in the preview, including keyboard access and a section list.
Selecting an area opens its relevant editor. Allow supported text, buttons and destinations, images, alt text, fit/focal point, section appearance, spacing, placement, order and visibility to be edited. Do not expose implementation IDs as the main customer/admin interaction.
Preserve cart, authentication, legal links and other essential workflows. Editing presentation cannot weaken eligibility, prices, tax, payment, authorization, or legal/business-state controls.
The map's presentation is editable in the builder. Coverage itself remains controlled in Settings, with a contextual action to reach those settings. Product selection/presentation uses the existing catalog; stock and prices remain authoritative in Inventory.
Use an explicit Save and apply action. Before save, edits are a clearly marked draft; after confirmed transactional save, public requests and all previews reflect the same revision. Do not report success on a failed upload, failed publication or stale save.
Persist draft progress so refresh/navigation/device changes do not discard saved draft work. Warn about unsaved changes and preserve edits across section/device switches. Separate draft and published revisions.
Use optimistic version checks and atomic publication with audit history and recoverable prior published revisions. Concurrent edits must report a conflict instead of overwriting silently. No partial public update if one section/image fails.
Preserve existing saved copy and section data during conversion. Do not reset the home page by re-seeding a template over published records.
If iframe messaging is used for previews, validate origin, source window and payload; prevent preview interactions from submitting orders or navigating away accidentally.

## 5. Photo upload, persistence and publication

Allow authorized staff to select, upload, preview, replace, reorder where applicable, and save photos from within the selected section. Include useful alt text and mobile cropping/focal controls.
Store image bytes durably using the approved storage adapter. Container-local files on Render are ephemeral and cannot satisfy this requirement. Reuse suitable existing assets and secure upload infrastructure; do not repurpose private business-document storage as public media.
Validate permissions and file content server-side, enforce size/pixel/count limits, reject unsupported/corrupt files and active content, normalize orientation, strip unnecessary metadata, and produce appropriately sized derivatives.
An upload is complete only after durable storage succeeds. Retain the prior working photo when upload/save fails. Prevent duplicate uploads on retry and use safe filenames/object keys.
Draft assets must remain private to authorized editors; only intentionally published marketing media may be public. Private delivery proofs, invoices and filing documents must never become website media.
Image references, publication and retention must remain consistent through rollback and deletion. Do not delete an asset still used by a published page.
Prove image persistence after browser refresh, second-device access and an application redeploy. Do not claim a hosted upload is accepted based only on a local adapter test.

## 6. Login, Google sign-in and credential recovery

Provide visible Log in/Create account on the home page and Account/Sign out behavior after authentication, on all devices.
Preserve email/password login, owner/admin landing rules, customer household accounts, session boundaries and mandatory bootstrap credential change.
Add accessible eye buttons to login, registration, password reset and password-change fields. Passwords start hidden; toggling must retain the value, preserve password-manager/autocomplete behavior, be keyboard operable, have an accurate Show/Hide label and never submit the form.
Enable working Continue with Google through the existing Auth.js integration with appropriate staging/production clients, secrets and exact redirect URIs. Require both client ID and secret for readiness.
Preserve least privilege and create a customer role/profile transactionally for a new Google customer. Prevent duplicate/orphan account records and unsafe same-email account linking. Never enable dangerous email-account linking or promote a customer to staff to make Google login work.
Add Forgot password / trouble signing in and a complete reset-email → expiring link → new password → sign-in flow.
Use cryptographically random, single-use, hashed-at-rest tokens with short expiry, purpose binding, atomic consume/password update/session revocation, retry-safe email delivery and per-account/IP rate limits. Never log tokens or return them in API responses.
For unknown addresses, keep the recovery response generic and timing reasonably uniform. Do not reveal whether an email has an account or whether it uses Google.
For Google-only users, provide a safe Google sign-in/recovery path; do not expose account identity or silently create a password without the proper ownership proof.
Forgot-email recovery must direct users to their own Google identity or a verified support process; do not reveal an email from a phone/ZIP/name lookup.
Use approved trusted origins for reset links, no arbitrary callback or host-header URLs, secure cookies/CSRF controls, consistent password length/UTF-8 byte rules, and no credential/state changes from a GET.
Invalidate prior reset tokens and existing sessions after successful reset; keep staff-role, account suspension and bootstrap constraints intact. Do not mark email verification or purchase approval complete as an accidental side effect.
Connect transactional email and email verification; test actual provider sandbox/delivery behavior separately from mocked tests. Do not send unsolicited messages or run bulk mail.
Do not expose OAuth secrets, email credentials, reset tokens or temporary passwords in chat, source, artifacts or logs.

## 7. Finish the full operating roadmap

Reconcile docs/ROADMAP.md with implementation evidence before changing statuses. It predates substantial work; unchecked does not always mean missing and a screen does not prove a working workflow.
Complete and verify:
- Inventory, vendors, PO receiving, landed cost/FIFO, stock adjustments, real photo storage and product publication.
- Account verification, address approval, cart/checkout, destination tax, authoritative pricing, capacity reservations, immutable sale/COGS snapshots and payment reconciliation.
- Refunds, stock return handling, reward restoration/reversal and referral awards with permanent financial/audit evidence and retry/concurrency tests.
- Quarterly-only subscriptions: explicit consent, scheduled order generation, pause/skip/cancel, pricing changes, capacity/inventory availability and past-due handling. Do not retain the old default 28-day cadence as the business rule.
- Delivery scheduling, route/day run, attempt handling, private proof photo, customer confirmation and appropriate notifications. Retain valid delivery promises when routes/configuration change.
- Real expense and mileage recording, source-backed CPA/financial/tax reports, reconciliation, imports/exports and idempotent QuickBooks integration. No fake deductible totals, recreated historical tax, silent overwrite or duplicate downstream posting.
- Durable scheduled workers for reconciliation and other recurring work, with locks/idempotency, retry limits, dead-letter/attention views, monitoring and recovery.
- API-first, machine-readable catalog, eligible ZIPs, availability/preorder dates, delivery windows, subscriptions, rewards, policies, checkout, orders and fulfillment. Keep an agent commerce gateway protocol-neutral with scoped authentication/consent and the same backend invariants; do not create UI-only business logic or bypasses for agents.
- Security/permissions, dependable backups with a tested restore, retention, observability, owner/admin operating tools, and runbooks.
Keep commerce closed where a real dependency is missing. Configuration flags are not substitutes for acceptance evidence.

## 8. Code review, tests, release and acceptance

For each completed increment: review the diff and data flow, perform focused domain/security/concurrency tests, run lint/typecheck/build and required repository CI, and preserve source SHA plus exact test evidence.
Add native PostgreSQL coverage for publication versions, rollback/audit, upload linkage, draft privacy, reset expiry/replay/concurrency/session invalidation, transactional customer creation, and finance records.
Add desktop/tablet/mobile browser acceptance for:
1. selecting any homepage area → editor → change → save → matching public page;
2. draft/section/device switching and interrupted/failed/stale saves;
3. upload and replace a valid image; invalid image and failed storage preserve the old image;
4. active ZIP addition/removal changes map/list and checker consistently; unknown/geocoder-failed ZIPs stay honest;
5. visible home login, Google flow, password eye, valid reset, expired/reused token, throttling and unknown-email response;
6. complete existing account, support, loyalty, inventory, receiving, checkout and delivery regressions.
Test keyboard access, focus, labels, touch targets, readable text, 200% zoom, empty/error/loading states and no horizontal overflow.
Preview QA must compare the actual shared-renderer output at all three device widths, not screenshots of separate approximate cards.
Use synthetic records only in isolated development/CI. Mocked Stripe, email, maps, storage or OAuth tests must be identified as mocks and cannot establish external-provider acceptance.

Integrate the feature chain without force pushes or bypassing reviews. Stage the exact tested source, verify migrations against retained history, take a current recovery checkpoint and prove existing records survive additive changes.
Never blindly deploy Render's current main branch: it is behind the inspected running feature source. Use a reviewed exact revision or first complete integration.
Before public launch, verify the actual approved production domain, separate production database/storage/auth resources, Stripe/live tax setup, email/OAuth configuration, owner/business setup, reviewed catalog/stock and delivery capacity, backup/restore, worker operation and a controlled end-to-end acceptance order.
Do not convert the staging database into production or copy synthetic accounts, payment evidence, orders or rewards into production.
The owner has requested launch; do not introduce repeated generic permission gates. Stop only for a concrete missing owner input, required external approval, access blocker or failed safety/acceptance gate, after completing all available preparation.
Do not announce go-live until the intended production deployment is healthy, access and checkout behave correctly, mandatory workflows are verified, and monitoring/recovery are operational.

## Execution checkpoint for resumption

On this turn the coding environment returned environment_offline (409) repeatedly, and the finance service write failed. No new finance, map, builder, upload or authentication implementation from this turn was validated or deployed.
The GitHub connector remained available, so this contract is preserved as a reviewable repository change. Reconnect the coding workspace, inspect its local finance scratch edits and remote branch state, and resume the build. Do not treat incomplete local files as an accepted migration or publish them without review.
Known source gaps directly observed: separate homepage/preview renderers; ignored dynamic section types/order on the homepage; no builder photo fields; catalog image storage restricted to development; no password-reset workflow or password eye; Google UI readiness checks only a client ID; signup writes user/role/customer in separate operations; finance/report placeholders.
