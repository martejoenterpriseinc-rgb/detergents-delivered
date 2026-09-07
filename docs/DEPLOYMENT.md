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

| | development | staging | production |
| --- | --- | --- | --- |
| Database | compose `detergents_delivered_dev` | isolated staging cluster | production cluster |
| Stripe / QBO | unset or sandbox | test / sandbox | live (Phase 3/7) |
| Seed admin | allowed | optional break-glass | forbidden via seed script |
| Backups | optional | daily | daily + PITR if the host offers it |

## Backups

- Production Postgres: automated daily backups and a tested restore path before go-live
- Keep migration history in git; never rewrite applied SQL
- Before a risky migrate: snapshot / backup, deploy to staging first, then production
- Object storage: versioning on the private bucket (receipts, delivery photos)

## Rollback

- Application: redeploy the previous image
- Schema: forward-fix preferred; keep migrations additive. If a migrate must roll back, restore from backup onto a new instance and point the app there — do not `DROP` financial tables

## Health

`GET /api/health` returns `{ ok, service, env, timestamp }`. Use it as the container / load-balancer probe. It does not query the database in Phase 1 (avoid false kills during migrate). Add a separate `/api/ready` in a later phase if we need DB readiness.
