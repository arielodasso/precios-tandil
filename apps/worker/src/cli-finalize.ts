import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { refreshAggregates } from './jobs/refresh-aggregates.ts';
import { refreshDailySeries } from './jobs/refresh-daily-series.ts';
import { detectDeals } from './jobs/detect-deals.ts';
import { purgeSingleSource } from './jobs/purge-single-source.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

try {
  logger.info('limpiando run_reports colgados');
  const fixed = await db
    .updateTable('run_report')
    .set({ status: 'failed' })
    .where('status', '=', 'running')
    .executeTakeFirst();
  logger.info(
    { rowsAffected: Number((fixed as { numUpdatedRows: bigint }).numUpdatedRows) },
    'run_reports arreglados',
  );

  logger.info('purgando productos de una sola fuente y precios < mínimo');
  const purgeResult = await purgeSingleSource(db, logger);
  logger.info({ ...purgeResult }, 'purga completada');

  logger.info('refrescando agregados');
  const aggResult = await refreshAggregates(db, logger);
  logger.info({ ...aggResult }, 'agregados refrescados');

  logger.info('refrescando serie diaria');
  const dsResult = await refreshDailySeries(db, logger);
  logger.info({ ...dsResult }, 'serie diaria refrescada');

  logger.info('detectando ofertas');
  const dealsResult = await detectDeals(db, logger);
  logger.info({ ...dealsResult }, 'oportunidades detectadas');
} finally {
  await db.destroy();
}
