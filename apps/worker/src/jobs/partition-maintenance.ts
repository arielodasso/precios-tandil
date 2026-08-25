import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { DB } from '@precios/shared';

/** Particiones mensuales mantenidas con anticipación. */
const PARTITIONS_AHEAD_MONTHS = 2;
/** Retención: particiones más viejas que N meses se eliminan (≈13 meses). */
const RETENTION_MONTHS = 13;
/** Nombre de tabla particionada gestionada por el job. */
export const PRICE_RECORD_TABLE = 'price_record';

export interface PartitionMaintenanceResult {
  created: string[];
  dropped: string[];
}

/**
 * T076 — Mantenimiento de particiones mensuales de price_record:
 *  - crea la partición del mes actual y las siguientes
 *    (price_record_y2026_m08, etc.) si no existen;
 *  - elimina particiones con datos más viejos que RETENTION_MONTHS.
 *
 * La conversión inicial a PARTITION BY RANGE (captured_at) vive en la
 * migración; este job solo mantiene el set de particiones al día.
 */
export async function partitionMaintenance(
  db: Kysely<DB>,
  logger?: Logger,
  opts: { now?: Date } = {},
): Promise<PartitionMaintenanceResult> {
  const now = opts.now ?? new Date();
  const created: string[] = [];
  const dropped: string[] = [];

  for (let i = -RETENTION_MONTHS; i <= PARTITIONS_AHEAD_MONTHS; i += 1) {
    const start = firstOfMonth(now, i);
    const end = firstOfMonth(now, i + 1);
    if (start.getTime() < now.getTime() - RETENTION_MONTHS * 31 * 86_400_000) {
      // fuera de retención: dropear si existe y no es la base
      continue;
    }
    const name = partitionName(start);
    await sql`
      create table if not exists ${sql.raw(`"${name}"`)}
      partition of ${sql.raw(`"${PRICE_RECORD_TABLE}"`)}
      for values from (${start.toISOString()}) to (${end.toISOString()})
    `.execute(db);
    created.push(name);
  }

  // Retención: dropear particiones viejas que existan en pg_inherits.
  const existing = await sql<{ relname: string; parent: string }>`
    select c.relname as relname, p.relname as parent
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = ${PRICE_RECORD_TABLE}
  `.execute(db);

  const retentionFloor = firstOfMonth(now, -RETENTION_MONTHS);
  for (const row of existing.rows) {
    const parsed = parsePartitionName(row.relname);
    if (!parsed || parsed.getTime() < retentionFloor.getTime()) {
      if (parsed) {
        await sql`drop table if exists ${sql.raw(`"${row.relname}"`)}`.execute(db);
        dropped.push(row.relname);
      }
    }
  }

  logger?.info(
    { event: 'partitions.maintained', created, dropped },
    'mantenimiento de particiones completado',
  );
  return { created, dropped };
}

export function partitionName(monthStart: Date): string {
  return `price_record_y${monthStart.getUTCFullYear()}_m${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function parsePartitionName(name: string): Date | null {
  const m = /^price_record_y(\d{4})_m(\d{2})$/.exec(name);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

function firstOfMonth(reference: Date, monthOffset: number): Date {
  return new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + monthOffset, 1, 0, 0, 0, 0),
  );
}
