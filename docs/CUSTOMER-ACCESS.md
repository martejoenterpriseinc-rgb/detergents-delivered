# Customer access and recovery

Implements the customer-access portion of [the go-live build contract](GO-LIVE-BUILD-CONTRACT.md). This document does not certify the other launch requirements or a production release.

## Customer behavior

- The home-page header has a visible Sign in button on desktop, tablet, and mobile.
- Sign-in, registration, password reset, account password changes, and mandatory bootstrap credential changes have accessible show/hide password buttons. Toggling never submits the form.
- Sign-in links to password and login-details recovery. Recovery explains Google account recovery and how to locate an account email without exposing a customer directory.
- Google sign-in appears only when both its client ID and secret are present. OAuth provisioning creates the user, CUSTOMER role, household profile, and audit together. A verified Google email is required. Existing password identities are not automatically linked; no self-service path assigns staff privileges.
- Password registration requires matching passwords of at least 12 characters and at most 72 UTF-8 bytes. Duplicate submissions cannot create a partial household.

## Password recovery

The request endpoint accepts only same-origin bounded JSON. Requests for known, unknown, deleted, OAuth-only, or throttled accounts receive the same generic success message when recovery is configured. An unavailable mail configuration returns the same temporary-unavailability response to every visitor. Provider work runs after the response, and requests use a minimum response duration to reduce simple account timing signals.

Links use 256-bit random tokens, expire after 30 minutes, and can be consumed once. Lookup uses a SHA-256 hash. A queued token is AES-256-GCM encrypted with purpose-separated key material derived from AUTH_SECRET and authenticated against its owner, email, and token hash. Ciphertext is erased after provider acceptance, consumption, expiry, or exhausted delivery attempts. Security records expire from the database after an additional day; permanent audits contain no tokens or passwords.

The email carries the token in a URL fragment, which is not sent in page requests or referrers. The browser reads and removes it from the visible URL; reopening the email link is required after a reload. Reset pages are noindex and use no-referrer metadata. Do not add session recording or analytics that capture authentication forms, fragments, or request bodies.

Reset consumption, password replacement, revocation of all outstanding reset links, session-version increment, stored-session removal, and audit insertion share a transaction under the user lock. A changed email, deleted user, expired/used link, or changed session version invalidates recovery. Mandatory bootstrap rotation is preserved. Password changes through authenticated settings and bootstrap rotation invalidate outstanding recovery links too.

Database throttles limit credential login, registration, reset requests, and token submissions across instances. Identifier keys are HMAC hashes; global limits bound CPU work and row creation. Hosting-level bot/DoS protection remains a separate launch requirement.

## Configuration and delivery

Use a fixed trusted HTTPS AUTH_URL in staging/production, a strong AUTH_SECRET, EMAIL_PROVIDER=sendgrid, an EMAIL_API_KEY with mail-send permission, and a verified EMAIL_FROM. The implementation accepts the existing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET names. Configure the Google redirect URI as the exact public origin plus /api/auth/callback/google.

Non-production email requires DD_EMAIL_ALLOWED_RECIPIENTS, a comma-separated list of approved test recipient emails. No unapproved recipient is sent a message. Tests intercept the provider call and never send real mail.

Schedule `npm run auth:deliver` every minute against the same isolated environment as the web app. Requests also trigger bounded immediate delivery after the HTTP response. The durable worker claims jobs with SKIP LOCKED and a lease, retries failures with backoff, caps attempts, and never logs message payloads or provider error bodies. A provider timeout after acceptance can produce the same email twice; it cannot create a second valid use of the link. HTTP 202 means provider acceptance, not inbox delivery.

Configure the scheduled worker before enabling production recovery. Monitor failed/expired jobs and verify actual inbox delivery using an approved test account. Rotating AUTH_SECRET revokes JWT sessions and makes pending encrypted payloads unreadable; allow users to request new reset links after rotation. Keep credentials server-side and out of site-builder content, exports, and customer APIs.

## Review and acceptance

Review the additive migration and changes to every password mutation and OAuth provisioning path. Apply and replay migrations on the isolated CI database; do not run tests against hosted customer databases. The tests cover duplicate registration, expired/replayed/concurrent tokens, encrypted payload cleanup, retry claims, unknown/deleted/OAuth-only accounts, changed email/session versions, preserved bootstrap gating, provider recipient restrictions, and session revocation. Browser checks cover the visible home login, password eye controls, recovery navigation, reset and subsequent sign-in on desktop/tablet/mobile.

Before release: require green CI on the exact source commit, verify Google consent/callback and account collision behavior with approved test accounts, verify SendGrid sender/inbox delivery and worker retries, then perform staging acceptance. Mocked provider tests do not satisfy those real-provider checks. No Google, SendGrid, Render, DNS, payment, or production database configuration is changed by this source patch.

Provider references: [Auth.js Google](https://authjs.dev/reference/core/providers/google), [SendGrid Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send). Next.js Server Action and after behavior was checked against the bundled Next 16.3.4 documentation.
