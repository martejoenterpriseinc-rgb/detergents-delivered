# Release record verification

`scripts/check-record-preservation.ts` captures SHA-256 fingerprints and row counts for every public application table. It retains column names and primary keys, never row values, credentials, image bytes or customer identifiers. Reads run in a read-only repeatable-read transaction, with UTC serialization, primary-key ordering, a bounded cursor and statement/transaction timeouts. Tables without primary keys stop the check. Migration history is excluded here and independently checked by `db:preflight`.

For a planned additive release, first retain a current recoverable database backup and its encryption keys, finish review of the exact source revision and migration SQL, and quiesce web writes and all workers. Capture before applying changes:

```
node --import tsx scripts/check-record-preservation.ts capture /secure/release-before.json
```

Use a durable private operator-controlled location. New files are exclusive and mode 0600. Retain the checkpoint's own file checksum together with the deployed source SHA, database snapshot identifier and release evidence. The file is comparison evidence, **not a backup**, and must not be edited to make verification pass.

After the reviewed migration operation, with writes still quiesced, run:

```
node --import tsx scripts/check-record-preservation.ts verify /secure/release-before.json
```

Verification projects the original columns so newly added columns do not falsely change historical rows. Missing retained tables, columns, changed primary keys, changed row values or counts fail. Database host/name and environment must match; a restored database on a different host needs a separately reviewed comparison procedure. New tables and new columns are outside the retained-record comparison and require migration/schema review. This does not establish restore acceptance, provider acceptance or go-live.

Any changed table stops acceptance. Identify the exact legitimate change or restore/reconcile from the retained backup; do not blindly recapture a new baseline. Activity during either capture can change the results, hence the required maintenance window. No migration, write, reset, data seeding, provider call or automatic repair is performed by this script. The prior two-migration refund deployment gate remains unchanged.

CI verifies migration replay preservation and an isolated PostgreSQL fixture demonstrates preservation across an added column, detection of same-count edits/deletes, identity rejection and bounded private output. Hosted execution is still pending the final release candidate.
