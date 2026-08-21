import { chromium } from 'playwright';
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { loadAdapters } from './scheduler/registry.ts';
import { startScheduler } from './scheduler/scheduler.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const adapters = await loadAdapters({
  warn: (msg, err) => logger.warn({ err }, msg),
});

async function createBrowserContext() {
  const browser = await chromium.launch({ headless: true });
  return browser.newContext({ locale: 'es-AR' });
}

const scheduler = await startScheduler({
  db,
  logger,
  adapters,
  connectionString: config.DATABASE_URL,
  proxies: config.PROXY_POOL_URL ? [config.PROXY_POOL_URL] : undefined,
  createBrowserContext,
});

logger.info('worker listo');

async function shutdown(signal: string) {
  logger.info({ signal }, 'apagando worker');
  await scheduler.stop();
  await db.destroy();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
