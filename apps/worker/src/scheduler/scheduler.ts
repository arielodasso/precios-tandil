import { randomUUID } from 'node:crypto';
import PgBoss from 'pg-boss';
import type { Logger } from 'pino';
import type { Kysely } from 'kysely';
import type { BrowserContext } from 'playwright';
import type { DB, StoreSlug } from '@precios/shared';
import type { ScraperAdapter } from '@precios/scraper-core';
import { IngestPipeline } from '../pipeline/pipeline.ts';

export const QUEUE_NIGHTLY = 'ingest-nightly';
export const QUEUE_INGEST = 'ingest';
export const QUEUE_AGGREGATES = 'aggregates';

const NIGHTLY_CRON_UTC = '0 3 * * *';
const AGGREGATES_CRON = '*/30 * * * *';

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
  for (const queue of [QUEUE_NIGHTLY, QUEUE_INGEST, QUEUE_AGGREGATES]) {
    await boss.createQueue(queue);
  }
  await boss.schedule(QUEUE_NIGHTLY, NIGHTLY_CRON_UTC);
  await boss.schedule(QUEUE_AGGREGATES, AGGREGATES_CRON);

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
    logger.debug('refresh-aggregates pendiente de implementación (US1/T035)');
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
