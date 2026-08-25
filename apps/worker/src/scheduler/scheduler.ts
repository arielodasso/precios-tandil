import { randomUUID } from 'node:crypto';
import PgBoss from 'pg-boss';
import type { Logger } from 'pino';
import type { Kysely } from 'kysely';
import type { BrowserContext } from 'playwright';
import type { DB, StoreSlug } from '@precios/shared';
import type { ScraperAdapter } from '@precios/scraper-core';
import { IngestPipeline } from '../pipeline/pipeline.ts';
import { refreshAggregates } from '../jobs/refresh-aggregates.ts';
import { refreshDailySeries } from '../jobs/refresh-daily-series.ts';
import { detectDeals } from '../jobs/detect-deals.ts';
import { opsAlerts } from '../jobs/ops-alerts.ts';
import { partitionMaintenance } from '../jobs/partition-maintenance.ts';

export const QUEUE_NIGHTLY = 'ingest-nightly';
export const QUEUE_INGEST = 'ingest';
export const QUEUE_AGGREGATES = 'aggregates';
export const QUEUE_DAILY_SERIES = 'daily-series';
export const QUEUE_DEALS = 'deals';
export const QUEUE_OPS_ALERTS = 'ops-alerts';
export const QUEUE_PARTITIONS = 'partition-maintenance';

const NIGHTLY_CRON_UTC = '0 3 * * *';
const AGGREGATES_CRON = '*/30 * * * *';
const DAILY_SERIES_CRON_UTC = '30 4 * * *';
const DEALS_CRON_UTC = '0 5 * * *';
const OPS_ALERTS_CRON_UTC = '15 * * * *';
const PARTITIONS_CRON_UTC = '0 6 25 * *';

export interface SchedulerOptions {
  db: Kysely<DB>;
  logger: Logger;
  adapters: Map<StoreSlug, ScraperAdapter>;
  connectionString: string;
  proxies?: string[];
  createBrowserContext: () => Promise<BrowserContext>;
}

export interface RunningScheduler {
  boss: PgBoss;
  stop(): Promise<void>;
}

export async function startScheduler(opts: SchedulerOptions): Promise<RunningScheduler> {
  const { db, logger, adapters } = opts;
  const boss = new PgBoss({ connectionString: opts.connectionString });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

  await boss.start();
  for (const queue of [
    QUEUE_NIGHTLY,
    QUEUE_INGEST,
    QUEUE_AGGREGATES,
    QUEUE_DAILY_SERIES,
    QUEUE_DEALS,
    QUEUE_OPS_ALERTS,
    QUEUE_PARTITIONS,
  ]) {
    await boss.createQueue(queue);
  }
  await boss.schedule(QUEUE_NIGHTLY, NIGHTLY_CRON_UTC);
  await boss.schedule(QUEUE_AGGREGATES, AGGREGATES_CRON);
  await boss.schedule(QUEUE_DAILY_SERIES, DAILY_SERIES_CRON_UTC);
  await boss.schedule(QUEUE_DEALS, DEALS_CRON_UTC);
  await boss.schedule(QUEUE_OPS_ALERTS, OPS_ALERTS_CRON_UTC);
  await boss.schedule(QUEUE_PARTITIONS, PARTITIONS_CRON_UTC);

  await boss.work<{ slug: string }>(QUEUE_NIGHTLY, async () => {
    const stores = await db
      .selectFrom('store')
      .select(['slug', 'config'])
      .where('is_active', '=', true)
      .execute();
    const now = Date.now();
    for (const store of stores) {
      const until = store.config.quarantinedUntil;
      if (until && new Date(until).getTime() > now) {
        logger.warn({ storeSlug: store.slug }, 'tienda en cuarentena — se omite ventana nocturna');
        continue;
      }
      await boss.send(QUEUE_INGEST, { slug: store.slug });
    }
    return undefined as never;
  });

  await boss.work<{ slug: string; runId?: string }>(
    QUEUE_INGEST,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const slug = job.data.slug as StoreSlug;
        const adapter = adapters.get(slug);
        if (!adapter) {
          logger.warn(
            { event: 'adapter_missing', storeSlug: slug },
            'sin adaptador registrado para la tienda',
          );
          continue;
        }
        let browserContext: BrowserContext;
        try {
          browserContext = await opts.createBrowserContext();
        } catch (err) {
          logger.error({ err, storeSlug: slug }, 'no se pudo crear contexto de navegador');
          continue;
        }
        try {
          const pipeline = new IngestPipeline(db, logger);
          await pipeline.run(adapter, {
            runId: job.data.runId ?? randomUUID(),
            correlationId: job.id,
            browser: browserContext,
            signal: AbortSignal.timeout(4 * 3_600_000),
            proxies: opts.proxies,
          });
        } finally {
          await browserContext.close().catch(() => undefined);
        }
      }
      return undefined as never;
    },
  );

  await boss.work(QUEUE_AGGREGATES, async () => {
    await refreshAggregates(db, logger);
    return undefined as never;
  });

  await boss.work(QUEUE_DAILY_SERIES, async () => {
    await refreshDailySeries(db, logger);
    return undefined as never;
  });

  await boss.work(QUEUE_DEALS, async () => {
    await detectDeals(db, logger);
    return undefined as never;
  });

  await boss.work(QUEUE_OPS_ALERTS, async () => {
    await opsAlerts(db, logger);
    return undefined as never;
  });

  await boss.work(QUEUE_PARTITIONS, async () => {
    await partitionMaintenance(db, logger);
    return undefined as never;
  });

  logger.info(
    { nightlyCronUtc: NIGHTLY_CRON_UTC, adapters: [...adapters.keys()] },
    'scheduler iniciado',
  );

  return {
    boss,
    async stop() {
      await boss.stop();
    },
  };
}
