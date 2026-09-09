# DetergentsDelivered Business Setup

This increment adds `/admin/settings/business/setup`, private `/admin/settings/business/documents`, and a dashboard continuation/completion card. It changes no commerce activation, legal provider identity, customers, inventory, orders, subscriptions, payments, delivery routes or launch settings. The existing launch date remains an independently saved draft.

## Rules and sources

`lib/business/definitions.ts` contains maintained task definitions, fees, URLs, source-review dates, evidence requirements and applicability. Research baseline: **September 9, 2026**. Primary sources were opened for county instructions/forms, Illinois LLC services/fees/annual instructions, the IRS, IDOR, FinCEN, IDES, Illinois insurance, SBA and Stripe Tax. McHenry $5 / Kane $10 filing, publication once weekly for three weeks, first within 15 days and proof to clerk within 50 days were confirmed. Kane lists optional $1 notary and $1 copy separately. Newspaper prices remain unquoted. Illinois formation is $150 and the standard annual report is $75. The official organizing guide confirms the anniversary-month deadline.

Lake in the Hills explicitly lists online business registration. Algonquin's supplied page returned 403; official indexed results provide Community Development at 847-658-2700 and refer to online home registration. The exact submission route remains visibly **Needs Verification**. This is not treated as evidence that online filing does not exist. MyTax's dynamic portal and the Stripe sole-proprietor support article could not be inspected; adjacent fallback notices retain the authoritative agency/account-support routes. Source reviews older than 90 days display a recheck notice. Do not treat this research date as a perpetual guarantee.

No SSN or external password fields are provided. Owner confirmations are not government-verification claims. Existing filings can be recorded without submitting another application. Multiple owners and unconfirmed/out-of-state profiles cannot select either Illinois single-owner process. Product handling and transfers create agency/professional review tasks. Unknown applicability must be resolved with a documented response. FinCEN's current U.S.-entity exemption is an applicability review, not a mandatory BOI filing.

## Persistence and authorization

Five additive tables hold the versioned setup, private revisions, explicit business-access grants, documents and document versions. Server validation and a PostgreSQL transaction/advisory lock enforce optimistic concurrency. All revisions and the minimal general audit entry commit together. A recorded filing permanently prevents casual structure/profile changes, even if its status is later reset. A reviewed transition creates a new plan without transferring IDs or completion evidence; old plans and documents remain retained.

SUPER_ADMIN is the owner role. An ADMIN requires an explicit owner grant to access either the wizard or documents. Ordinary staff/customer accounts cannot access them. Only the owner may choose/change structure, approve a transition, finish the checklist, grant access or delete documents. Role revocation is checked against the database for each API operation and each download.

## Private documents

Document bytes are encrypted with AES-256-GCM before being stored as PostgreSQL BYTEA. Each version has a random nonce, authentication tag and version-specific authenticated context. Keys are separate from application authentication secrets and never stored in source, the database or audit logs. Durable private PostgreSQL storage avoids the host's ephemeral filesystem. Total retained payload is limited to 250 MB and 500 versions; files are limited to 5 MB. This deliberately bounded store is suitable for setup records, not an unbounded media archive.

Operator environment configuration:

- `DD_BUSINESS_DOCUMENT_KEYS`: JSON map of key IDs to independently generated 32-byte hexadecimal keys.
- `DD_BUSINESS_DOCUMENT_ACTIVE_KEY`: active key ID. Retain previous keys until all their retained documents/backups are retired or re-encrypted.
- `DD_DOCUMENT_SCANNER_PATH`: absolute path to a maintained **clamscan** executable with current official signature databases. This is not a clamdscan setting.

Use HTTPS ingress and the existing private database transport; protect encryption keys in the host secret store and backup recovery procedure. Never copy staging keys/data to production.

Actual content type and size are checked; images are decoded/re-encoded with metadata removed. PDFs with detected active content or password protection are rejected. These checks are not antivirus. The configured ClamAV process scans every valid upload using a random private temporary filename; output and document content are never logged. Errors, timeouts, skipped/ambiguous scans and missing configuration leave encrypted bytes **QUARANTINED**. A positive detection is rejected. No owner override marks an unscanned file clean. Retry scanning is available after the scanner is connected. A scanner must be maintained with current signatures and adequate memory before claiming hosted scan acceptance.

Only CLEAN versions can be used as evidence or opened. Download grants expire in 90 seconds and also require a current authorized session; grants bind user, session version and document version. Routes use no-store, nosniff, sandbox and no-referrer headers and never expose public object URLs. Replacement retains prior encrypted versions and resets linked completed-step review. Owner deletion removes all payloads, retains audit/version metadata, and reopens evidence-dependent completion; database backups expire under host retention.

## External actions / rollout

Government applications, fees, signatures, identity verification, bank/insurance selection and tax/legal review remain owner actions on external sites. No application is submitted, payment made, legal entity renamed or live storefront enabled by this wizard.

Deploy only after native PostgreSQL migration replay/integration checks and desktop/mobile browser acceptance. Back up staging and compare existing rows before/after the additive migration. Rollback is an app rollback while retaining additive tables; do not drop saved documents or evidence. Empty-table removal is an operator-only rollback after confirming there is no saved data.

Tests use isolated `detergents_delivered_ci` PostgreSQL. Scanner CLEAN/REJECTED integration verdicts are mocked explicitly; browser upload tests exercise real encrypted database persistence with the missing scanner remaining quarantined. They are not proof of live ClamAV operation. Hosted encryption configuration and actual scanner acceptance must be reported separately from code tests.
