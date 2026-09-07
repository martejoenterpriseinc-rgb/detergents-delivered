# Test plan

## Layers

| Layer | Tool | What belongs here |
| --- | --- | --- |
| Unit | Vitest | `lib/domain` money, inventory, authz — no I/O |
| Integration | Vitest + Postgres (CI service) | Prisma constraints, seed, authz against DB (later) |
| E2E | Playwright (Phase 3+) | Checkout, reserve, receive, deliver |

Phase 1 requires unit tests for money, inventory math, and authorization. CI also runs lint, typecheck, `prisma validate`, migrate, and `next build`.

## Phase 1 cases (implemented)

Money:

- add / subtract integer cents
- reject floats
- format cents
- margin in basis points from cents

Inventory:

- available = on-hand − reserved
- reject negative on-hand / reserved / available
- reject oversell
- reserve cannot exceed on-hand

Authz:

- SUPER_ADMIN bypass
- role allow-list
- permission codes and `*`
- role→permission mapping

## Failure cases to keep adding

| Area | Must fail closed |
| --- | --- |
| Money | Float inputs, overflow beyond safe integers |
| Inventory | Oversell, silent balance UPDATE, deleting a ledger row |
| Auth | Missing session on `/admin`, CUSTOMER hitting write APIs, CPA POST |
| Payments (P3) | Replay webhook, bad signature, double capture |
| Tax (P7) | Missing snapshot, recomputing historical tax |
| QBO (P7) | Duplicate sales receipt on retry |
| Routing (P5) | Schedule over zone capacity without override |

## Commands

```bash
npm run test:unit
npm run lint
npm run typecheck
npm run db:validate
npm run build
```

CI: `.github/workflows/ci.yml` (Postgres 16 service, same commands).

## Acceptance before production

See [DEPLOYMENT.md](./DEPLOYMENT.md). Staging acceptance is not “the build is green” — walk storefront, sign-in, admin shell, driver shell, and `/api/health` on the staging URL.
