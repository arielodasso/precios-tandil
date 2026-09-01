import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { AppError, type StoreSlug } from '@precios/shared';
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { loadAdapters } from './scheduler/registry.ts';
import { IngestPipeline } from './pipeline/pipeline.ts';
import { refreshAggregates } from './jobs/refresh-aggregates.ts';
import { refreshDailySeries } from './jobs/refresh-daily-series.ts';
import { detectDeals } from './jobs/detect-deals.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const adapters = await loadAdapters({
  warn: (msg, err) => logger.warn({ err }, msg),
});

const STORES_TO_SCRAPE: StoreSlug[] = [
  'golopolis',
  'carrefour',
  'monarca',
  'comerciante-maxi',
  'dia',
  'cooperativa-obrera',
  'vea',
];
const PER_STORE_TIMEOUT_MS = 45 * 60_000; // 45 minutos por tienda

logger.info({ stores: STORES_TO_SCRAPE }, 'iniciando ingest-all');

const browser = await chromium.launch({ headless: true });
const results: Array<{
  store: StoreSlug;
  status: string;
  captured: number;
  rejected: number;
  error?: string;
}> = [];

try {
  for (const slug of STORES_TO_SCRAPE) {
    const adapter = adapters.get(slug);
    if (!adapter) {
      logger.warn({ store: slug }, 'adaptador no disponible, saltando');
      results.push({
        store: slug,
        status: 'skipped',
        captured: 0,
        rejected: 0,
        error: 'adapter_missing',
      });
      continue;
    }

    logger.info({ store: slug }, 'iniciando scrape');
    const context = await browser.newContext({ locale: 'es-AR' });
    const pipeline = new IngestPipeline(db, logger);

    try {
      const summary = await pipeline.run(adapter, {
        runId: randomUUID(),
        correlationId: `ci-all-${Date.now()}`,
        browser: context,
        signal: AbortSignal.timeout(PER_STORE_TIMEOUT_MS),
        proxies: config.PROXY_POOL_URL ? [config.PROXY_POOL_URL] : undefined,
      });
      logger.info({ store: slug, ...summary }, 'scrape completado');
      results.push({
        store: slug,
        status: summary.status,
        captured: summary.captured,
        rejected: summary.rejected,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof AppError && err.code === 'adapter_missing') {
        logger.warn({ store: slug }, 'adaptador no implementado, saltando');
        results.push({ store: slug, status: 'skipped', captured: 0, rejected: 0, error: msg });
      } else {
        logger.error({ store: slug, err }, 'scrape falló');
        results.push({ store: slug, status: 'error', captured: 0, rejected: 0, error: msg });
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  // --- Post-scrape: fix run_reports stuck en "running" ---
  logger.info('limpiando run_reports stuck');
  const fixed = await db
    .updateTable('run_report')
    .set({ status: 'failed' })
    .where('status', '=', 'running')
    .executeTakeFirst();
  logger.info(
    { rowsAffected: Number((fixed as { numUpdatedRows: bigint }).numUpdatedRows) },
    'run_reports arreglados',
  );

  // --- Post-scrape: refresh aggregates ---
  logger.info('refrescando agregados');
  const aggResult = await refreshAggregates(db, logger);
  logger.info({ ...aggResult }, 'agregados refrescados');

  // --- Post-scrape: refresh daily series ---
  logger.info('refrescando serie diaria');
  const dsResult = await refreshDailySeries(db, logger);
  logger.info({ ...dsResult }, 'serie diaria refrescada');

  // --- Post-scrape: detect deals ---
  logger.info('detectando ofertas');
  const dealsResult = await detectDeals(db, logger);
  logger.info({ ...dealsResult }, 'oportunidades detectadas');

  // --- Resumen final ---
  logger.info({ results }, 'resumen de ingest-all');
  const errors = results.filter((r) => r.status === 'error');
  if (errors.length > 0) {
    logger.error({ errors }, 'algunas tiendas fallaron');
    process.exitCode = 1;
  }
} finally {
  await browser.close().catch(() => undefined);
  await db.destroy();
}
