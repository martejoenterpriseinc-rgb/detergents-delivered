# Storefront and website builder

The Render app is the operational site. Its home page now uses the pale blue storefront layout and hero photo from the preferred Sites reference. Catalog cards still read published products, current prices and available inventory; the reference site's sample products are not imported.

## Editing and publishing

Open Website → Builder. Select an area from the page preview or the area selector. Edit headings, descriptions, actions, photos, image fit, alignment, spacing, visibility and order. Header, navigation, announcement, footer and colors are editable too. Product records remain in Inventory; delivery ZIPs remain in Settings → Launch & capacity.

Photo position has independent horizontal/vertical controls for desktop/tablet and mobile (up to 520px). Both the public page and preview use the same crop settings. In-app navigation preserves unsaved work by asking the editor to save a draft, apply changes or explicitly reload to discard. Reloading or closing the browser also warns about unsaved changes. Preview links stay in the preview even when Click to edit is disabled; use View storefront for the normal customer workflow.

Published versions lists retained publications in pages of 20. Loading an earlier publication changes only the editor; Save & apply is still required to restore it publicly. The current version check continues to protect against concurrent edits. The first save captures the initial publication as a recoverable baseline. History is administrator-only and includes the retained photo references. An earlier loaded version with a missing retained photo cannot be published until the reference is repaired.

**Save & apply** publishes the full document atomically. **Save draft** persists unfinished work without changing the public page. Reload resumes the saved draft. A failed save retains local edits and can be retried with the same request key. Concurrent saves require the last accepted version, preventing silent overwrites. Reload saved version explicitly discards unsaved local edits. Each accepted save records an immutable revision and audit event; the API never accepts client-supplied audit identity.

The storefront and builder use `StorefrontChrome` and `StorefrontHome`. Computer (1440×900), tablet (768×1024) and mobile (390×844) previews run in actual iframe viewports; the builder scales the frame to fit its workspace. The iframe and its messages require the same origin and the expected parent/frame window. The preview route requires ADMIN or SUPER_ADMIN and has no-index metadata. “Click to edit” captures section selection; turn it off to inspect the normal layout. Preview uses the visitor header. Verify account-dependent purchasing in the storefront using an appropriate customer account.

Essential sign-in/account/cart links, legal policy destinations and the authoritative ordering state remain connected to their real workflows. Editor notes, supplier costs, private inventory records and draft content are not serialized into the public home page.

The How it works and product sections use distinct inner-grid classes. Reusing a section's type class for its inner grid previously constrained the whole section to one grid column, squeezing step titles into broken words. Both sections now use the full content width. Steps remain three columns on desktop/tablet and stack at widths up to 520px. Browser acceptance measures the actual section widths, row/column geometry and shared preview, and captures the How it works section at all three device sizes.

## Durable photos

Website photo uploads are available in hosted environments without a temporary local-disk dependency. JPEG, PNG and WebP uploads up to 4 MiB and 24 megapixels are decoded, rotated, stripped of metadata and re-encoded as WebP (maximum dimension 2400). Animated and unsupported formats are rejected. Images are stored as immutable PostgreSQL bytes with dimensions, content hash and upload audit records. Duplicate image content reuses the same record. A transaction serializes quota checks; the initial shared website quota is 100 MiB.

Unpublished photos require a website-manager session. A photo becomes publicly readable only while referenced by a visible published section or the published logo. Hidden or removed photos stop being publicly readable. Responses use no-store and nosniff to avoid serving a revoked draft through public caches. Uploaded images use unoptimized Next images so the media authorization endpoint sees the request session; bundled public assets may use Next's optimizer.

Database backups therefore include website photos. Restore a backup to a separate database and verify content, media and revision records before a production switch. Do not mix this marketing facility with private business documents or proof-of-delivery files. Existing catalog and proof image storage are separate workflows and must pass their own launch checks.

### Photo recovery and storage status increment

Failed uploads retain the selected file in the current tab and leave the prior photo intact. Retry upload remains tied to the original section even after changing areas or preview devices. Save draft and Save & apply wait until unfinished uploads are retried or explicitly discarded. Reload saved version also explicitly discards pending files. Browser-close warnings still apply; files cannot be recovered from another device until the upload succeeds and its draft is saved. Retrying after a committed upload's response is lost reuses the same content hash, image and audit event.

Integrations includes Website photos & logos with actual retained count, used bytes and an 80% capacity warning. The default limit remains 100 MiB; `DD_WEBSITE_MEDIA_LIMIT_MB` permits a reviewed limit of 1–1024 MiB. Review database capacity before increasing it. A full budget permits retries of an already saved image, while rejecting new content without changing the previous record. Stored bytes are checked against their saved size, content hash and content type before being served. Historical and published references are retained; this increment performs no media deletion or schema change.

Native coverage verifies concurrent deduplication, one audit event, independent database-client reads, integrity failure, audit rollback and quota behavior. Desktop/tablet/mobile acceptance exercises failure, lost-response retry, area/device switching, discard, refresh, private drafts and final publication. CI acceptance and the final hosted deployment evidence are recorded below. Synthetic acceptance does not establish a real owner-provided photo/redeploy exercise.

## Delivery coverage

The public map and ZIP list derive from active `DeliveryZone.boundaryJson.postalCodes`, the same source used by purchasing eligibility. A ZIP present in multiple active zones is excluded, matching checkout's ambiguity rule. Counties do not grant purchasing access. No customer locations appear in this map.

The browser requests `/api/delivery-coverage` on load, every minute while visible, and when the page becomes visible. Changes in settings therefore appear without a rebuild. Missing geographic centers are resolved in bounded batches after the response, with per-ZIP leases, three-second timeouts, response-size limits, positive caching and retry backoff. Missing/provider-failed centers leave the authoritative ZIP list usable. Geographic lookups never authorize an order.

Markers represent approximate ZIP centers, not boundaries. Their viewport fits all known centers as the area grows. The map is limited to a compact 300px visual, with a collapsible ZIP list and the actual delivery checker beside it. Missing basemap tiles display a fallback notice.

Zoom in, Zoom out and Fit all ZIP codes are keyboard-accessible controls. A change to the set of located ZIPs resets the viewport to fit the new coverage. Unchanged refreshes retain the selected zoom.

Map sources: [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/) and [Zippopotam.us API and data license](https://api.zippopotam.us/). Attribution is visible on the map. Browser tiles use the official URL, normal browser caching and referrers, with no offline tile prefetching. These services provide no guaranteed uptime; production traffic beyond their permitted usage requires an appropriate map provider. ZIP lookups send only configured public ZIP codes, never addresses or customer records.

## Database rollout and acceptance

Apply additive migration `20260913100000_storefront_builder` after the customer-access migration. It adds versioned page/draft settings, immutable revision records, durable website media and cached public ZIP centers. It preserves existing section copy and visibility, connects the former fixed featured/steps slots to the shared renderer, adds the bundled hero image to existing heroes, and adds a map only when a map section does not already exist. It does not enable checkout or change delivery settings.

Acceptance covers draft/publish separation, save replay, conflicting editors, missing-photo rollback, actual database image persistence, publication-based media access, malformed/oversized image rejection, active ZIP additions/removals and inactive zones, failed lookups, cross-origin denial, customer-role denial, failed-save retention and preview geometry at each device size. Hosted migration, real editor uploads and provider/checkout acceptance must be verified on the exact deployed build before declaring go-live.


## Layout and photo recovery acceptance — September 9, 2026

Application source `1990362a0fdf050c3fbef2e52474a00c05b977be`, tree `e16a06dd048a7fbabeaf61e54d29dfb749fe3f17`, draft PR [#24](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/pull/24). [CI #83](https://github.com/martejoenterpriseinc-rgb/detergents-delivered/actions/runs/34418501085) passed lint, generated route types/build, migration application/replay, 220 unit tests, 89 native PostgreSQL checks and 31 desktop/tablet/mobile browser scenarios (340 total). Artifact `10130145833` retains screenshots and traces. The How it works section was visually reviewed at all three widths: full-width content, three readable columns at desktop/tablet sizes and stacked steps on mobile. Browser checks also compare actual product/step widths and preview geometry.

The failed-upload scenario preserves the previous photo, blocks save until retry/discard, switches areas and device sizes, loses a response after a real isolated-database commit, retries without an extra image/audit, and verifies refresh/private-draft/publication behavior. Native checks passed concurrent deduplication, independent-client reads, corruption detection, audit rollback and capacity handling. No new schema migration is included.

Both web services were promoted to that exact accepted application revision: staging deploy `dep-dagv4albedkc738cdcig` became live at September 9 23:58:56 UTC; production deploy `dep-dagv4irl550s73cthghg` became live at 23:59:34 UTC. Workers retain their previously accepted `b7f3af6` revision because this increment makes no worker change. Auto Deploy and Blueprint Auto Sync remain off.

After a fresh hosted page load, the original squeezed step grid grew from 364px to the full 1136px content area at the inspected desktop viewport, in both environments. The actual sandbox heading and saved step copy remain intact. Integrations now reports Website photos & logos alongside product/proof storage, and the saved Production destination remains visible. CI provides the mobile/tablet and iframe checks; the hosted desktop correction was also visually reviewed. This release does not activate checkout or establish production owner/provider/business acceptance; the remaining launch prerequisites in `PRODUCTION-OPERATIONS.md` still apply.

Read-only post-deploy checks on September 10 returned readiness 200 and unauthenticated integration metadata 401 for both web services, each reporting application revision `1990362`. Staging retains 2 users and 1 customer; production retains zero users/customers. Both have zero products, orders, payment events and website photos, with checkout disabled. No provider request, customer message, test order or hosted image upload was performed by this acceptance.

### Compact mobile steps

On screens up to 520px, How it works uses a compact list with each 36px number beside its heading and optional description. Title-only steps render no empty paragraph; duplicate eyebrow/title text is shown once. Desktop and tablet keep three columns, and saved content and explicit section-spacing choices remain intact. The shared preview uses this same layout. Browser acceptance covers the actual title-only copy from the hosted page as well as description-bearing content, draft reload/publication, aligned mobile rows and a bounded section height.
