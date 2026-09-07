# Test plan

## Layers

| Layer       | Tool                           | What belongs here                              |
| ----------- | ------------------------------ | ---------------------------------------------- |
| Unit        | Vitest                         | `lib/domain` money, inventory, authz — no I/O  |
| Integration | Vitest + Postgres (CI service) | Receiving → balance update, oversell rejection |
| E2E         | Playwright (Phase 3+)          | Checkout, reserve, receive, deliver            |

Phase 2 requires unit tests for money, landed cost, inventory `applyTransaction`, reorder, and authorization, plus a Postgres integration test for receive → ledger. CI also runs lint, typecheck, `prisma validate`, migrate, and `next build`.

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
- `applyTransaction` for purchase receipt, reservation, delivery, inbound damage, loss

Landed cost / margin:

- header freight allocated by merchandise weight
- remainder cents on the last positive-qty line
- line extras stay on that line
- gross profit $ and margin % from integer cents

Reorder:

- at or below point → low stock
- zero available without a point → out of stock

Authz:

- SUPER_ADMIN bypass
- role allow-list
- permission codes and `*`
- role→permission mapping

Delivery schedule:

- default Tue/Thu windows and McHenry / Kane / Cook enablement
- `nextDeliverySlot` given config + now (skip today; honor cutoff)
- ZIP checker respects enabled counties and never claims same-day

## Failure cases to keep adding

| Area          | Must fail closed                                                   |
| ------------- | ------------------------------------------------------------------ |
| Money         | Float inputs, overflow beyond safe integers                        |
| Inventory     | Oversell, silent balance UPDATE, deleting a ledger row             |
| Auth          | Missing session on `/admin`, CUSTOMER hitting write APIs, CPA POST |
| Payments (P3) | Replay webhook, bad signature, double capture                      |
| Tax (P7)      | Missing snapshot, recomputing historical tax                       |
| QBO (P7)      | Duplicate sales receipt on retry                                   |
| Routing (P5)  | Schedule over zone capacity without override                       |

## Commands

```bash
npm run test:unit
npm run test:integration
npm run lint
npm run typecheck
npm run db:validate
npm run build
```

CI: `.github/workflows/ci.yml` (Postgres 16 service, same commands).

## Acceptance before production

See [DEPLOYMENT.md](./DEPLOYMENT.md). Staging acceptance is not “the build is green” — walk storefront, sign-in, admin shell, driver shell, and `/api/health` on the staging URL.
