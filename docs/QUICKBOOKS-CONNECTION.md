# QuickBooks company authorization

Reports → QuickBooks connection provides explicit administrator consent, an Intuit OAuth redirect, company verification, refresh and disconnect. CPA access is read-only. Accounting posting remains disabled; this increment does not claim expense/sales/refund/COGS synchronization or provider acceptance.

The existing encrypted API editor supplies this environment's client ID, secret and intended company ID. The callback is exactly the current trusted AUTH_URL origin plus `/api/admin/quickbooks/callback`. Intuit app registration must include this URI. Sandbox and production use separate provider namespaces and companies; the browser cannot select the server environment.

Starting a connection requires a same-origin authenticated POST and explicit confirmation. A 256-bit state is hashed in persistent storage, expires in ten minutes, binds the current administrator/session version and complete provider configuration, and is consumed once before token exchange. Starts are limited to six per administrator/hour. A mismatched company, different administrator, rotated session, replay, stale configuration or changed connection version stops completion. A read-only CompanyInfo request to the intended environment/company confirms that the received token can access that company before it is saved.

Access/refresh tokens are encrypted using the existing retained integration keyring with connection/version-specific authenticated context. Token and authorization-code values are excluded from application audits, status DTOs, errors and browser storage. The callback immediately redirects to a clean local URL with no-referrer/no-store headers. Hosting request-log policy must redact OAuth callback query strings; no callback URLs containing codes should be included in support artifacts.

Refresh and disconnect claim a durable version before network I/O. Parallel refreshes cannot replay a token. Failed or interrupted refresh blocks use and requires a new authorization; a rotated token is not blindly retried. Disconnect blocks local use immediately. Failed revocation retains its encrypted token for a retry after 30 seconds; confirmed revocation removes the saved token. A changed client/company configuration invalidates local use and requires restoring the original configuration for revocation. These transitions and their successful outcomes are audited transactionally.

Only fixed Intuit HTTPS endpoints are used, with redirects disabled, bounded responses and eight-second timeouts. No source records are posted, no inventory is changed, and there is no automatic connection or background refresh loop in this increment. Human Intuit authorization and real sandbox/live acceptance remain external prerequisites.

Implementation references reviewed September 11, 2026:

- [Intuit OAuth client source](https://github.com/intuit/oauth-jsclient/blob/master/src/OAuthClient.js): authorization, token exchange/refresh, revocation and headers.
- [Intuit SDK authorization guide](https://intuit.github.io/QuickBooks-V3-PHP-SDK/authorization.html): explicit human company authorization and exact redirect URI.
- [Intuit SDK configuration](https://intuit.github.io/QuickBooks-V3-PHP-SDK/configuration.html): environment endpoints and company binding.
- [Intuit DataService source](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/DataService/DataService.php): company-scoped entity reads.

Tests use synthetic records and mocked Intuit responses. Native coverage exercises replay/concurrency, role/company/session isolation, audit rollback, encryption, refresh uncertainty and revocation recovery. Browser coverage checks explicit company confirmation, failed connection recovery and CPA isolation on desktop/tablet/mobile. This is implementation evidence, not real provider acceptance.
