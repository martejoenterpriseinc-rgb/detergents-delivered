# Deployment

## Pipeline

```
feature branch → unit/CI → PR review → merge main → staging deploy → acceptance → production
```

1. **Branch** from `main`. Name it for the change (`cursor/phase-1-foundation-289a` or similar).
2. **Tests** locally: `lint`, `typecheck`, `test:unit`, `db:validate`, `build`.
3. **PR** into `main`. GitHub Actions must be green (install, lint, typecheck, unit tests, Prisma validate + migrate on a service Postgres, build).
4. **Staging** deploys the same Docker image. `APP_ENV=staging`. Staging database and Stripe **test** keys only.
5. **Acceptance** on staging: health, sign-in, admin/driver shells, no production data.
6. **Production** promote. `APP_ENV=production`. Protected environment: required reviewers, required checks, no force-push to `main`.

Development must not use the production `DATABASE_URL`. `lib/env.ts` throws if `APP_ENV=development` and the URL looks like production.

## Artifacts

- `Dockerfile` — multi-stage Node 22, Next.js `standalone` output
- Process binds `0.0.0.0:$PORT` (`npm start`)
- `docker-compose.yml` — Postgres 16 + app (staging baseline / local)
- Apply migrations **before** serving: `npx prisma migrate deploy`

Filesystem is ephemeral. Uploads go to object storage (S3 placeholders). Do not write lasting data to the container disk.

## Environment matrix

|              | development                                          | staging                                                | production                         |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------ | ---------------------------------- |
| Database     | compose `detergents_delivered_dev`                   | isolated staging cluster                               | production cluster                 |
| Stripe / QBO | unset or sandbox                                     | test / sandbox                                         | live (Phase 3/7)                   |
| Seed admin   | allowed (bootstrap + optional `SEED_ADMIN_*`)        | bootstrap if no admin, or `SEED_BOOTSTRAP_ADMIN=true`  | forbidden via seed script          |
| Demo catalog | `SEED_DEMO_CATALOG` / `DEMO_MODE`                    | `DEMO_MODE=true` if shop is empty                      | never auto-seed                    |
| Backups      | optional                                             | daily                                                  | daily + PITR if the host offers it |

## Backups

- Production Postgres: automated daily backups and a tested restore path before go-live
- Keep migration history in git; never rewrite applied SQL
- Before a risky migrate: snapshot / backup, deploy to staging first, then production
- Object storage: versioning on the private bucket (receipts, delivery photos)

## Rollback

- Application: redeploy the previous image
- Schema: forward-fix preferred; keep migrations additive. If a migrate must roll back, restore from backup onto a new instance and point the app there — do not `DROP` financial tables

## Health

`GET /api/ready` performs read-only database schema probes and returns 503 on configuration/connection/schema failure. Use it for readiness; `/api/health` is liveness only.


`GET /api/health` returns `{ ok, service, env, timestamp }`. Use it as the container / load-balancer probe. It does not query the database in Phase 1 (avoid false kills during migrate). Add a separate `/api/ready` in a later phase if we need DB readiness.

## Bootstrap admin

Bootstrap is an explicit, one-time operation in development/staging only. It never automatically creates an administrator, resets an existing password, promotes an existing customer, revives a deleted account, or recreates the bootstrap account after owner credential rotation.

Set `SEED_BOOTSTRAP_ADMIN=true` and enter a unique `SEED_BOOTSTRAP_ADMIN_PASSWORD` (20–72 UTF-8 bytes) through secure environment entry, then run `npm run db:seed` only after database review. There is no default password. The seed validates the password before any writes and serializes concurrent administrator creation in a database transaction. Remove the temporary password and turn the flag off afterward. First login still requires a different email/password.

The seed refuses production and an unspecified environment. Existing historical public default credentials remain rejected by credential-change validation; never use them to create or access an account.

## Existing Render repair

See [RENDER_REPAIR.md](RENDER_REPAIR.md) for the reviewed source, exact existing resources, safe start command, database preflight, test evidence and remaining access blocker. `npm start` now validates runtime configuration and migration history without applying migrations. The old Render command `npx prisma migrate deploy && npm start` must be changed before connecting a database. No migration SQL was edited by this repair.
