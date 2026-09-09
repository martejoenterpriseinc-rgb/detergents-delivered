# Current environment API checkpoint

Latest continuation: the owner's requested API row editor is now deployed to staging at `aaf9845b14eb2f22b6b4849fd600ae11eaec8e94` after CI77 passed 325 checks. Settings and Integrations share 23 fields with Edit, Save/Update, masked values and status, plus a prominent Sandbox/Production switch and separate-app destination setup. Read `docs/API-ROW-EDITOR-RELEASE.md` for the current acceptance and recovery limits. PRs #21 and #22 remain published; staging uses the tested application SHA, and subsequent release-record changes are documentation only. Earlier publication blockers are resolved and must not cause another permission request.

Owner request: separate sandbox/live APIs in Settings, correct API selection by environment, red sandbox banner on every page. Earlier owner authorization allows pushing and deployment; the historical authorization block below is not a new instruction to request permission.

- Worktree: `/workspace/detergents-environments`; branch `feature/environment-api-isolation`, based on local builder `c8c4e21`.
- Implemented separate environment panels in Settings/Integrations, secure hosting credential links, server-authoritative provider namespaces, webhook selection and a persistent runtime sandbox banner.
- Local verification: lint, TypeScript, 200 unit/security tests and optimized Next.js webpack build passed. Fresh Prisma generation was interrupted when network approval was cancelled; no fresh generation success is claimed. PostgreSQL/browser checks remain CI work, with new desktop/tablet/mobile environment acceptance added.
- Render discovery confirms only the DetergentsDelivered staging service exists. Live switch stays disabled without its separately provisioned URL. Staging auto-deploy is off and its configured main branch is older than the manually deployed source.
- No new migration. Inherited customer-access and builder migrations still require their existing release checks. No hosted data, credentials or payments changed during implementation.
- See `docs/ENVIRONMENT-APIS.md` for migration: hosted generic credentials need an explicit matching environment binding before rollout, or complete prefixed provider configuration. Do not silently disable an already working provider during deployment.
- Local implementation commit: `80d3421da99ccbb04253e36ae861ddf0a9acb231`, followed by this checkpoint/banner-offset adjustment.
- Automatic approval review rejected the atomic push of `feature/storefront-builder` and `feature/environment-api-isolation` to `https://github.com/martejoenterpriseinc-rgb/detergents-delivered.git`. Stated reason: newly committed code was being pushed to an unverified private remote and the user had not explicitly approved publishing to that named destination. No alternate publishing path or reattempt was used. Source remains committed locally; CI, fresh Prisma generation, database/browser acceptance and deployment are pending.
- Publication approval received: the owner explicitly approved pushing both feature branches to `martejoenterpriseinc-rgb/detergents-delivered`. The approval block is resolved. The shell push then failed because no command-line GitHub credential is installed; publication is proceeding through the authenticated GitHub connector. Preserve the existing stacked branches and reviewed deployed SHA; never force-push or deploy the older main branch.

---

## Previous builder checkpoint (historical)

# DetergentsDelivered build checkpoint

Status: local implementation and local checks only. The changes in this checkpoint are not pushed, deployed or accepted for launch.

## Source and deployment authority

- Repository: `martejoenterpriseinc-rgb/detergents-delivered`.
- Working branch: `feature/storefront-builder`.
- Remote dependency: `feature/customer-access` at `e44587885b4fc31c4781d6b62fe89237e40b556a`, draft PR #20. The earlier stacked PRs remain open.
- Recovered local builder implementation: `f0f42a54181433166d2d4ed21df52ee85ab2c0d0`.
- Render still reports `e99feb8a9db9816de5e375a19c6cd218bb107e6c` live on `srv-daffhfqd0e5s73c76v2g` in workspace `tea-d9nvrlnqj5pc73fmf610`.
- The selected Render admin and Sites storefront reference were inspected. The Render admin still has the older unconsolidated drawer. New source must not be described as already visible there.
- Auto-deploy is disabled; the Render service's `main` is older than its manually deployed revision. Do not use an unpinned deployment.

## Completed locally this turn

- Reviewed the recovered shared storefront, builder, durable website-media and active-ZIP coverage implementation.
- Added desktop/tablet and mobile photo focal-position controls, with server validation and shared preview/public styles.
- Added protected, paginated publication history and restoration into the editor, retaining explicit Save & apply and optimistic version checks. The first save preserves the pre-builder publication as a baseline.
- Added protection for unsaved changes when following app navigation. Preview links and form submissions cannot leave the preview or submit checkout actions. Normal map/menu controls remain usable when edit selection is off.
- Added accessible map zoom and fit controls. New coverage resets the fit; unchanged refreshes retain zoom.
- Reused one request-scoped published document for page content and layout so a concurrent publication cannot mix their revisions.
- Fixed Google credential selection so empty primary settings fall back consistently to the supported alternative names. Credential presence is not OAuth acceptance.
- Replaced the Integrations placeholder with an administrator-only status dashboard and `GET /api/admin/integrations`. It reuses backend configuration checks, exposes no secrets, provides provider callback addresses and separates configuration, verification and missing implementation.
- Extended unit, security, PostgreSQL and desktop/tablet/mobile acceptance coverage. Confirmed the existing defaults already include the delivery map; added an assertion rather than a second map or migration.

## Verification and release gates

Local lint, 174 unit/security checks, TypeScript and the Next.js optimized production build passed. Provider configuration tests are local checks; no provider connection or inbox delivery is certified.

The full `npm run build` path and standalone Prisma validation were interrupted by a cancelled network approval in Prisma tooling. The successful local build ran the installed Next.js compiler with the already generated Prisma client. Fresh Prisma generation and validation remain CI gates; they are not claimed as passed here.

Native PostgreSQL integration tests, migration replay and browser acceptance for the builder are still unexecuted on this revision. The workspace has no PostgreSQL server, and package installation failed on container permission restrictions. The existing integration guard remains intact and forbids hosted databases. No tests, seeds or migration commands were run against staging or production data. The repository CI already contains PostgreSQL 16 and the required desktop/tablet/mobile checks; run it on the exact pushed source before deployment.

Automatic approval review rejected `git push origin feature/storefront-builder`: the stated reason was that "continue build" did not explicitly authorize exporting source to this GitHub destination. No alternate publishing path was used. The owner must approve publishing the reviewed feature branch to this exact repository before retrying. This block also prevents running CI on the new source and staging its exact reviewed revision.

The builder depends on additive migrations `20260912100000_customer_access` and `20260913100000_storefront_builder` (check exact paths in the tree before rollout). This turn adds no further schema migration. Before staging, verify migration history and checksums, capture a recovery checkpoint and prove existing records survive. Preserve the earlier staging releases and the open PR chain; no force pushes or review bypasses.

## Remaining full-launch work

- Google consent/callback, SendGrid sender/inbox tests and scheduled recovery worker acceptance.
- Controlled Stripe sandbox checkout, tax, webhook and reconciliation acceptance before any production commerce decision.
- Hosted catalog photos and private delivery-proof storage remain restricted to development in current adapters. Website-media storage does not solve these separate workflows.
- Quarterly subscriptions/order generation, refunds and related ledger reversals, accounting/CPA workflows, expenses, mileage, imports/exports and QuickBooks remain to be finished and verified.
- SMS consent/delivery, scheduler heartbeat/monitoring, backup restore, retention and controlled end-to-end launch acceptance remain required.
- The protocol-neutral agent commerce gateway remains an explicit full-build requirement, with the same backend business rules.
- No production release, payment activation, DNS change or unrelated BidSmooth/Martejo change occurred.
