import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { refreshAggregates } from './jobs/refresh-aggregates.ts';
import { refreshDailySeries } from './jobs/refresh-daily-series.ts';
import { detectDeals } from './jobs/detect-deals.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

try {
  logger.info('refrescando agregados');
  const agg = await refreshAggregates(db, logger);
  logger.info({ ...agg }, 'agregados refrescados');

  logger.info('refrescando serie diaria');
  const ds = await refreshDailySeries(db, logger);
  logger.info({ ...ds }, 'serie diaria refrescada');

  logger.info('detectando ofertas');
  const deals = await detectDeals(db, logger);
  logger.info({ ...deals }, 'oportunidades detectadas');
} finally {
  await db.destroy();
}
