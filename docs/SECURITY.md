# Security

## Authentication

Auth.js (NextAuth v5) issues JWT sessions.

- **Credentials**: email + bcrypt password hash on `User.passwordHash`
- **Google OAuth**: enabled only when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (or `AUTH_GOOGLE_*`) are set
- Pages: `/sign-in`. Callbacks default to `/account`
- `AUTH_SECRET` is required. Rotate independently per environment
- `NEXTAUTH_URL` / `AUTH_URL` must match the public origin

Seed a bootstrap SUPER_ADMIN (`admin@detergentsdelivered.com`) in development/staging when no admin exists, or when `SEED_BOOTSTRAP_ADMIN=true`. Optional custom `SEED_ADMIN_*` remains development-only. Never seed production this way. The bootstrap user has `mustChangeCredentials=true` and cannot use `/admin` until email and password are rotated. See [DEPLOYMENT.md](./DEPLOYMENT.md).

## Authorization

| Helper | Where | Behavior |
| --- | --- | --- |
| `proxy.ts` | Edge-adjacent request gate | Redirects unauthenticated users away from `/admin`, `/driver`, `/account`; sends `mustChangeCredentials` users to `/account/change-credentials` |
| `requireAuth` | Server | Session required (does not bypass the credential gate) |
| `requireRole` | Server | Role allow-list; `SUPER_ADMIN` passes roles but not the credential-change gate |
| `requirePermission` | Server | Role→permission map; `*` for super admin; same credential gate |
| `requireApiRole` | Route handlers | 401 / 403 JSON, including `credentials_change_required` |

Roles:

- **CUSTOMER** — storefront account
- **ADMIN** — operations
- **INVENTORY** — stock and purchasing writes
- **DRIVER** — driver mode
- **CPA** — read-focused finance (admin shell, no write APIs)
- **SUPER_ADMIN** — full access

Layouts are not enough for mutations. Every write API must call `requireApiRole` (or successor).

The website builder (`/admin/website`, `/api/admin/site/*`) is ADMIN / SUPER_ADMIN only. INVENTORY and CPA can use the admin shell but cannot publish storefront sections.

## Secrets

- Real secrets never belong in git. `.env*` is ignored except `.env.example`
- Stripe, QBO, Maps, email, SMS, and S3 keys are placeholders until their phase
- Production secrets live in the host secret manager, not in images
- Different `AUTH_SECRET` and database credentials per environment

## Webhooks (future)

When Stripe/QBO webhooks land:

- Verify signatures with the environment’s webhook secret
- Reject replayed `externalId`s (`PaymentEvent.externalId` is unique)
- Treat the payload as untrusted input
- Idempotent handlers only — insert events, then derive payment status

## Private media

Product images, vendor files, invoices, and delivery photos use storage keys (`storageKey`). They are **not** world-readable public URLs. Admin reads go through `/api/media/*` after `requireApiRole`. Storefront may serve only images on website-visible products via `/api/catalog/media/[id]`. Do not put private files in `public/`.

## CSRF / XSS

- Auth.js cookie settings + same-site cookies for session
- Server Actions and App Router form posts
- React escapes rendered text
- Do not use `dangerouslySetInnerHTML` for catalog or customer notes
- Validate API bodies with Zod

## Rate limits

Phase 1 does not ship a redis-backed limiter. Before public launch:

- Rate-limit `/api/auth/*` and `/sign-in` at the reverse proxy
- Rate-limit webhook endpoints by IP + signature failure count
- Lock out repeated credential failures (or use Auth.js / provider tooling)

## Production protection

- Protected `main`
- Required CI
- No production database access from development (`lib/env.ts` guard)
- Least-privilege DB roles for the app vs migrations vs backups
