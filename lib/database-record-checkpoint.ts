import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

const name = z.string().min(1).max(63);
export const recordCheckpointSchema = z
  .object({
    version: z.literal(1),
    environment: z.string().min(1),
    databaseHash: z.string().regex(/^[a-f0-9]{64}$/),
    tables: z
      .array(
        z
          .object({
            name,
            columns: z.array(name).min(1).max(100),
            keyColumns: z.array(name).min(1).max(10),
            count: z.number().int().nonnegative(),
            hash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(250),
  })
  .strict();
export type RecordCheckpoint = z.infer<typeof recordCheckpointSchema>;
const quoted = (value: string) => '"' + value.replaceAll('"', '""') + '"';

/** Hashes only; no row values or credentials leave this function. */
export async function recordCheckpoint(
  db: PrismaClient,
  identity: { environment: string; databaseHash: string },
  baseline?: RecordCheckpoint,
) {
  if (
    baseline &&
    (baseline.environment !== identity.environment ||
      baseline.databaseHash !== identity.databaseHash)
  )
    throw new Error("Checkpoint belongs to a different database or environment.");
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15000ms'`;
      const columns = await tx.$queryRaw<
        Array<{ table_name: string; column_name: string }>
      >`
      SELECT c.table_name, c.column_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
      WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND c.table_name <> '_prisma_migrations'
      ORDER BY c.table_name, c.ordinal_position`;
      const keys = await tx.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      WITH selected AS (
        SELECT DISTINCT ON (i.indrelid) i.indrelid, i.indkey, i.indnkeyatts
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
        JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
        WHERE n.nspname='public' AND i.indisunique AND i.indisvalid
          AND i.indpred IS NULL AND i.indexprs IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM unnest(i.indkey) WITH ORDINALITY k(attnum, position)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
            WHERE k.position <= i.indnkeyatts AND NOT a.attnotnull
          )
        ORDER BY i.indrelid, i.indisprimary DESC, ix.relname
      )
      SELECT t.relname::text AS table_name, a.attname::text AS column_name
      FROM selected i JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, position)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
      WHERE k.position <= i.indnkeyatts
      ORDER BY t.relname, k.position`;
      const specifications =
        baseline?.tables ??
        [...new Set(columns.map((c) => c.table_name))].map((table) => ({
          name: table,
          columns: columns
            .filter((c) => c.table_name === table)
            .map((c) => c.column_name),
          keyColumns: keys
            .filter((k) => k.table_name === table)
            .map((k) => k.column_name),
        }));
      const tables: RecordCheckpoint["tables"] = [];
      for (const spec of specifications) {
        const available = columns
          .filter((c) => c.table_name === spec.name)
          .map((c) => c.column_name);
        const currentKey = keys
          .filter((k) => k.table_name === spec.name)
          .map((k) => k.column_name);
        if (
          !spec.keyColumns.length ||
          JSON.stringify(currentKey) !== JSON.stringify(spec.keyColumns) ||
          spec.columns.some((c) => !available.includes(c))
        )
          throw new Error(
            "A retained table, column or stable unique key is missing or changed.",
          );
        // Identifiers come from catalog metadata and are quoted; baseline identifiers
        // must exist in that metadata. FETCH bounds memory even for stored images.
        await tx.$executeRawUnsafe(
          `DECLARE dd_record_cursor NO SCROLL CURSOR FOR SELECT jsonb_build_array(${spec.columns.map(quoted).join(",")})::text AS row FROM public.${quoted(spec.name)} ORDER BY ${spec.keyColumns.map(quoted).join(",")}`,
        );
        const hash = createHash("sha256");
        let count = 0;
        for (;;) {
          const rows = await tx.$queryRawUnsafe<Array<{ row: string }>>(
            "FETCH FORWARD 16 FROM dd_record_cursor",
          );
          if (!rows.length) break;
          for (const { row } of rows) {
            hash.update(row);
            hash.update("\n");
            count++;
          }
        }
        await tx.$executeRawUnsafe("CLOSE dd_record_cursor");
        tables.push({
          name: spec.name,
          columns: spec.columns,
          keyColumns: spec.keyColumns,
          count,
          hash: hash.digest("hex"),
        });
      }
      return recordCheckpointSchema.parse({ version: 1, ...identity, tables });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 },
  );
}

export function compareRecordCheckpoints(
  before: RecordCheckpoint,
  after: RecordCheckpoint,
) {
  if (
    before.environment !== after.environment ||
    before.databaseHash !== after.databaseHash
  )
    throw new Error("Checkpoint identity mismatch.");
  return before.tables
    .filter((table) => {
      const next = after.tables.find((t) => t.name === table.name);
      return (
        !next ||
        table.count !== next.count ||
        table.hash !== next.hash ||
        JSON.stringify(table.columns) !== JSON.stringify(next.columns) ||
        JSON.stringify(table.keyColumns) !== JSON.stringify(next.keyColumns)
      );
    })
    .map((table) => table.name);
}
