import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { AppError, type StoreSlug } from '@precios/shared';
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { loadAdapters } from './scheduler/registry.ts';
import { IngestPipeline } from './pipeline/pipeline.ts';

function argValue(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) {
    throw new AppError('invalid_query', `Uso: ingest ${flag} <valor>`);
  }
  return process.argv[idx + 1]!;
}

const config = loadConfig();
const slug = argValue('--store') as StoreSlug;
const db = createDb(config.DATABASE_URL);
const adapters = await loadAdapters({ warn: (msg, err) => logger.warn({ err }, msg) });

const adapter = adapters.get(slug);
if (!adapter) {
  logger.error(`Sin adaptador para ${slug}. Registrados: ${[...adapters.keys()].join(', ')}`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: 'es-AR' });
  const pipeline = new IngestPipeline(db, logger);
  const summary = await pipeline.run(adapter, {
    runId: randomUUID(),
    correlationId: `manual-${Date.now()}`,
    browser: context,
    signal: AbortSignal.timeout(4 * 3_600_000),
    proxies: config.PROXY_POOL_URL ? [config.PROXY_POOL_URL] : undefined,
  });
  logger.info(summary, 'corrida manual finalizada');
} finally {
  await browser.close().catch(() => undefined);
  await db.destroy();
}
