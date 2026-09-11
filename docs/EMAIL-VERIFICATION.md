# Customer email verification

September 11 owner-access correction: inbox verification is separate from site ownership. The authenticated hosting owner can explicitly authorize the first-owner grant to an existing account with completed credentials, preserving its unverified email, password and customer profile. See PRODUCTION-OWNER.md. Owner account views omit the verification prompt; customer verification and recovery remain available to ordinary customers. This supersedes the earlier statement below that email-provider/inbox verification must precede every owner grant.

## Setup location and launch timing

Owner direction on September 11: continue development with provider connections deferred to launch preparation. Email setup lives in Settings → API connections → SendGrid email, also shared by Integrations. Each existing field has Edit, Save/Update and its own status, with independent sandbox and production values. The expandable launch guide covers sender verification, a Mail Send key, sandbox recipient restrictions, real verification/recovery delivery checks and the separate owner grant. It links to official SendGrid instructions. This guide does not send email, mark delivery verified or grant a role. Connecting and proving providers remains required before enabling checkout; it does not block further development.

The first production owner still requires hosting-operator setup because an unprivileged customer cannot open API settings. This is not bypassed by the launch guide.

The same existing account keeps its customer profile, password and roles. Email verification establishes inbox ownership only; it never grants owner/admin access, approves an address, or enables checkout. The separate initial-owner command still requires a verified account and explicit authorization.

An authenticated customer requests a link from Account. The server selects the account email from the current session identity; the API accepts no recipient, user ID or roles. The SendGrid connection uses the existing environment-separated email vault and trusted origin. Non-production recipients must be explicitly allowlisted. Missing configuration displays an unavailable state and creates no token or provider request.

Links contain 256 random bits and expire after 30 minutes. The existing `VerificationToken` table stores only a hash with an application/purpose prefix bound to user ID, email hash and session generation. No migration is required. Password changes, email changes, suspension or unfinished credentials prevent use of old links. Visiting the page performs no mutation; a signed-in user must select Confirm email. The browser removes the token fragment from the visible URL and never sends it in a page request or referrer.

Confirmation locks the current user, checks the binding/expiry, saves verification, consumes all sibling verification links and writes an audit in one transaction. An audit failure rolls everything back. Repeated confirmation for the same already-verified account returns its verified state without another audit or role change. Tokens are never returned in API responses or audit records.

Sending is synchronous with a bounded provider timeout and no automatic background retries. A rejected, interrupted or uncertain send reports failure; the customer can resend, subject to the persisted three-request/15-minute limit. Resending preserves earlier unexpired links, including emails accepted by the provider before a response was lost. Pending hashes without a delivered email cannot be recovered as links; request a new email. Expired records for that account are removed on its next request; successful verification removes all its namespaced records.

Native tests cover concurrency, rollback, account/email/session binding, invalid/expired links, purpose isolation, unavailable providers, send failures, bounded resends and preserved credentials/roles. Browser coverage uses synthetic tokens in the guarded disposable CI database and covers explicit confirmation and lost-response retry. It does not establish real SendGrid delivery or inbox ownership.

Production inspection on September 11 found the intended owner's existing customer account unverified and both email and Google providers unconfigured. No production email, email-verification mutation or owner grant was performed during preparation. Real provider configuration, inbox verification and the separate audited owner grant remain required.
