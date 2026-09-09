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
