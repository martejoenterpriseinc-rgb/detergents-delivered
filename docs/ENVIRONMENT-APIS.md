# Sandbox and live API isolation

Settings and Integrations show separate Sandbox and Live panels, each with its API address, Google callback and Stripe webhook. Only administrators can inspect this configuration. Secret values never appear in the page, API response, URL, logs or browser storage. Manage API keys opens the current Render service's secure environment editor. Saving hosting credentials requires restarting/redeploying that service; this is not an in-browser secret store.

The environment switch is an ordinary full navigation to the other configured app's Settings. It transfers no cookies, tokens, cart state or records. Authentication must be established separately on the destination. Missing destinations remain disabled, and the other service's credentials are not reported as verified from this service. Application API calls remain same-origin relative requests.

## Server authority

`APP_ENV=development` or `staging` selects Sandbox; `APP_ENV=production` selects Live. Unknown values block provider configuration. Browser state, query parameters and headers cannot select a provider environment. The same resolver is used by payment/tax clients, webhook verification, Google OAuth, recovery email and recovery scripts. Background jobs run under their own explicitly configured service environment.

The red sandbox bar is rendered from the running server in the root layout, above customer, admin, driver and preview pages, including page error/not-found content using that layout. It remains visible on scroll. Live services omit it. An unknown environment displays a configuration error bar. Dynamic rendering avoids baking the build machine's environment into customer HTML.

Each hosted environment must have its own database, authentication secret, provider credentials, storage and workers. Existing pinned database and production identity checks remain enforced. This change creates no database, copies no data, changes no business records and adds no schema migration.

## Host configuration

Set `AUTH_URL` to the current application's trusted origin. Set `DD_SANDBOX_APP_URL` and `DD_LIVE_APP_URL` only to reviewed deployment origins. Both addresses may be present on either service, but must be different; the current environment's address must match `AUTH_URL`. URLs containing credentials, paths, query strings or fragments are rejected. HTTPS is required except loopback development. Configured URLs are navigation destinations, not evidence that the remote app has passed acceptance.

Only mount the current environment's provider namespace in that service:

| Provider | Sandbox service | Live service |
| --- | --- | --- |
| Stripe server key | `DD_SANDBOX_STRIPE_RESTRICTED_KEY` or `DD_SANDBOX_STRIPE_SECRET_KEY` | `DD_LIVE_STRIPE_RESTRICTED_KEY` or `DD_LIVE_STRIPE_SECRET_KEY` |
| Stripe account | `DD_SANDBOX_STRIPE_ACCOUNT_ID` | `DD_LIVE_STRIPE_ACCOUNT_ID` |
| Stripe webhook | `DD_SANDBOX_STRIPE_WEBHOOK_SECRET` | `DD_LIVE_STRIPE_WEBHOOK_SECRET` |
| Google OAuth | `DD_SANDBOX_GOOGLE_CLIENT_ID`, `DD_SANDBOX_GOOGLE_CLIENT_SECRET` | `DD_LIVE_GOOGLE_CLIENT_ID`, `DD_LIVE_GOOGLE_CLIENT_SECRET` |
| SendGrid | `DD_SANDBOX_EMAIL_PROVIDER=sendgrid`, `DD_SANDBOX_EMAIL_API_KEY`, `DD_SANDBOX_EMAIL_FROM` | `DD_LIVE_EMAIL_PROVIDER=sendgrid`, `DD_LIVE_EMAIL_API_KEY`, `DD_LIVE_EMAIL_FROM` |
| Approved email recipients | `DD_SANDBOX_EMAIL_ALLOWED_RECIPIENTS` (required) | `DD_LIVE_EMAIL_ALLOWED_RECIPIENTS` (optional restriction) |

Optional publishable keys use the corresponding `DD_SANDBOX_STRIPE_PUBLISHABLE_KEY` or `DD_LIVE_STRIPE_PUBLISHABLE_KEY`. Hosted checkout currently does not require them. Prefer one least-privilege server key; restricted keys take precedence when both server-key options are supplied. Stripe keys must match their test/live mode. Mounting any opposite provider namespace blocks startup and provider use. Providers without an implemented adapter (including QuickBooks and SMS) remain marked Build required in Integrations.

No missing field falls back to the other namespace. If any field for a provider is configured in its namespace, the entire provider group must use that namespace; fields cannot fall back to older generic names. Stripe account identity and event `livemode` checks remain in force before reconciliation. Disabling new checkout does not disable correctly configured payment recovery.

## Migration and deployment

1. Inspect the existing service's configuration securely before rollout. Preserve currently working credentials. Do not print or copy secrets through chat, commits or reports.
2. For an existing hosted provider still using generic names, explicitly set `DD_LEGACY_INTEGRATION_ENVIRONMENT=sandbox` on staging or `live` on production before deploying this change. This temporarily binds the existing credentials to exactly that environment. Without a matching binding, generic hosted credentials are ignored and the provider is unavailable. Development retains generic synthetic credentials for local tests.
3. Replace each complete provider group with the prefixed names in a single reviewed environment update. Remove unused generic names afterward. Remove the temporary binding once every configured provider is migrated. Use separate provider clients/accounts or service-scoped restricted credentials where supported. Google and email do not advertise Stripe-style test/live key prefixes, so provider-side scope still needs verification.
4. Configure the same environment namespace on each worker. Startup/runtime guards must execute before jobs. Keep sandbox recovery recipients restricted to approved test inboxes.
5. Run CI on the exact pushed commit: lint, types, unit/security, PostgreSQL integration, migration replay and desktop/tablet/mobile browser checks. This branch includes the previously local storefront-builder work and its existing additive migrations; verify that dependency's migration history/recovery before staging it. No new migration is added by API isolation itself.
6. Deploy a pinned reviewed commit only after its dependencies and host configuration pass. Preserve rollback code and configuration together. Current Render main is older than the manually deployed staging revision; an unpinned deployment is unsafe.
7. Verify the hosted sandbox bar and Settings, Google callback, approved recovery inbox, Stripe sandbox checkout/tax, signed webhook and recovery workflow. Do not mark configuration presence as provider acceptance.
8. Provision and initialize a separate clean live service before enabling its switch. Do not promote sandbox customers, orders, rewards, media or credentials. Production ordering still requires existing checkout and operational acceptance gates.

## Verification scope

Unit coverage exercises both service modes, unknown environment rejection, wrong-mode and opposite-namespace credentials, namespace/legacy separation, trusted/distinct origins, redacted Settings output, and missing live destinations. Webhook HTTP tests verify the actual chosen signing secret, ignore browser-supplied environment selectors, and reject wrong-account/wrong-mode events before database access. Browser coverage checks sandbox pages and scrolling plus authenticated Settings and protected metadata across desktop, tablet and mobile. Browser/database tests require the existing isolated loopback CI database and never target hosted data.

Provider accounts, real delivery, live hosting, database restoration and production launch are separate acceptance work. This implementation does not certify them.
