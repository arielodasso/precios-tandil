/**
 * Refresca agregados de precios y la serie diaria (para operaciones one-off).
 *
 * Uso:
 *   pnpm --filter @precios/worker refresh
 */
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { refreshAggregates } from './jobs/refresh-aggregates.ts';
import { refreshDailySeries } from './jobs/refresh-daily-series.ts';

async function run() {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  try {
    const aggregates = await refreshAggregates(db, logger);
    const series = await refreshDailySeries(db, logger);
    logger.info({ ...aggregates, ...series }, 'refresh: completado');
  } finally {
    await db.destroy();
  }
}

run().catch((err) => {
  logger.error({ err }, 'refresh falló');
  process.exitCode = 1;
});
