import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { DB } from '@precios/shared';

export interface RefreshDailySeriesResult {
  refreshedAt: Date;
}

/**
 * T052 — Refresca la vista materializada daily_series (mínimo y promedio
 * de precios válidos por producto por día) sin bloquear lecturas.
 * Requiere el índice único ux_daily_series_product_day (migración 0002).
 */
export async function refreshDailySeries(
  db: Kysely<DB>,
  logger?: Logger,
  opts: { now?: Date } = {},
): Promise<RefreshDailySeriesResult> {
  const now = opts.now ?? new Date();
  const startedAt = Date.now();

  await sql`refresh materialized view concurrently daily_series`.execute(db);

  logger?.info(
    { event: 'daily_series.refreshed', durationMs: Date.now() - startedAt },
    'serie diaria refrescada',
  );
  return { refreshedAt: now };
}
