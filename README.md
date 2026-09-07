# Detergents Delivered

Standalone ecommerce, subscription, inventory, local delivery, and accounting platform for **DetergentsDelivered.com**.

This is a greenfield product. It is not Martejo, BidSmooth, or any other company system. Branding, schemas, and code are original.

One Next.js app serves every mode:

- **Storefront** — shoppers and household accounts
- **Admin** — operations, catalog, inventory, finance
- **Driver** — route execution on the same codebase

Shared business rules live in `lib/domain/`. UI route groups do not own money, tax, or inventory logic.

## Status

Phase 2 catalog, purchasing, receiving, and inventory are implemented on this branch. Checkout, Stripe, delivery, subscriptions, and QuickBooks are **not** complete.

## Stack

- TypeScript, React 19, Next.js 16 App Router
- PostgreSQL + Prisma
- Auth.js (credentials + optional Google OAuth)
- Tailwind CSS v4 + lightweight shadcn-style UI
- Vitest, ESLint, Prettier
- Docker Compose for local Postgres / staging baseline
- GitHub Actions CI

Money is **integer cents**. Never use floating point for currency.

## Quickstart

```bash
cp .env.example .env.local
# set AUTH_SECRET (openssl rand -base64 32)
# keep DATABASE_URL on the local compose database — not production

docker compose up -d postgres
npm install
npm run db:generate
npm run db:migrate
# optional, development only:
# APP_ENV=development SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=... SEED_DEMO_CATALOG=true npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Health check: [http://localhost:3000/api/health](http://localhost:3000/api/health).

### Verify locally (same commands as CI)

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run db:validate
npm run build
```

If Docker is unavailable, point `DATABASE_URL` at any empty Postgres 16 database and run `npm run db:migrate`.

### Phase 2 demo path (vendor → shop)

With `APP_ENV=development` and `SEED_DEMO_CATALOG=true`, `npm run db:seed` will:

1. Create vendor **Midwest Household Supply**
2. Create several detergent variants (different SKUs, costs, prices, sizes)
3. Create a PO, mark it **ORDERED**, and receive it
4. Publish the product (`websiteVisible`)
5. List those SKUs on `/shop` from the same database

You can also do the same steps in admin: Categories → Products → Vendors → Purchase Orders → Receiving → toggle website visible.

## Environment

Copy `.env.example`. It lists every integration placeholder:

`DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_*`, `STRIPE_*`, `QBO_*`, `MAPS_*`, `EMAIL_*`, `SMS_*`, `S3_*`, `NEXTAUTH_URL`.

Rules:

| Environment | Data | Secrets | Deploy |
| --- | --- | --- | --- |
| **development** | Local compose DB only. Seed admin allowed. | Test / sandbox keys. | Laptop or ephemeral preview. |
| **staging** | Isolated staging database and Stripe test mode. | Staging secrets. | Docker image from `main` or a release candidate. |
| **production** | Production database. Protected branch + review. | Production secrets in the host vault only. | After staging acceptance. |

`APP_ENV=development` refuses a `DATABASE_URL` that looks like production. Do not seed production from `SEED_ADMIN_*`.

Google OAuth is optional. Credentials sign-in works without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Prisma generate + production build |
| `npm run start` | Bind `0.0.0.0:$PORT` (default 3000) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` / `test:unit` | Vitest unit tests |
| `npm run test:integration` | Vitest + Postgres (receive → ledger) |
| `npm run db:generate` | Prisma client |
| `npm run db:migrate` | Apply migrations (`deploy`) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:seed` | Roles + optional SUPER_ADMIN |

## App map

| Path | Mode | Access |
| --- | --- | --- |
| `/` | Storefront home | Public |
| `/shop` | Live catalog from the same DB | Public |
| `/sign-in` | Credentials (+ Google when configured) | Public |
| `/account/*` | Household account shell | Authenticated |
| `/admin/*` | Operations shell | ADMIN, INVENTORY, CPA, SUPER_ADMIN |
| `/driver/*` | Driver shell | DRIVER, ADMIN, SUPER_ADMIN |
| `/api/health` | Liveness | Public |

Roles: `CUSTOMER`, `ADMIN`, `INVENTORY`, `DRIVER`, `CPA`, `SUPER_ADMIN`.

## Branch → PR → staging → production

1. Create a feature branch from `main`.
2. Implement with tests for any domain change.
3. Open a PR. GitHub Actions runs install, lint, typecheck, unit tests, `prisma validate`, migrate against a service Postgres, and build.
4. After review, merge to `main`.
5. Deploy the image to **staging**. Run acceptance (see `docs/DEPLOYMENT.md` and `docs/TEST_PLAN.md`).
6. Promote the same artifact to **production**. Production is protected: required checks, no force-push, no unreviewed schema changes.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Database](docs/DATABASE.md)
- [Security](docs/SECURITY.md)
- [Accounting](docs/ACCOUNTING.md)
- [QuickBooks](docs/QUICKBOOKS.md)
- [Tax](docs/TAX_ARCHITECTURE.md)
- [Inventory](docs/INVENTORY.md)
- [Routing](docs/ROUTING.md)
- [Test plan](docs/TEST_PLAN.md)
- [Deployment](docs/DEPLOYMENT.md)

## License

Proprietary. All rights reserved.
