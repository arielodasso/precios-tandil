import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'node-pg-migrate';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { Logger } from 'pino';
import type { DB, StoreSlug } from '@precios/shared';
import type { ScraperAdapter } from '@precios/scraper-core';
import type { ProductSnapshot } from '@precios/shared';
import { startTestDb, type TestDb } from '../helpers/db.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DIA_FIXTURE = path.join(ROOT, 'packages/adapters/dia/tests/fixtures/dia-listing-arroz.html');
const C4_FIXTURE = path.join(
  ROOT,
  'packages/adapters/carrefour/tests/fixtures/carrefour-category-arroz.html',
);
const MIGRATIONS_DIR = path.join(ROOT, 'db/migrations');

const { parseListing: parseDia } = await import('../../../packages/adapters/dia/src/index.ts');
const { parseListing: parseCarrefour } =
  await import('../../../packages/adapters/carrefour/src/index.ts');
const { IngestPipeline } = await import('../../../apps/worker/src/pipeline/pipeline.ts');

let pool: Pool | null = null;
let db: Kysely<DB> | null = null;
let containerStop: (() => Promise<void>) | null = null;
let dbDisponible = false;

class SnapshotAdapter implements ScraperAdapter {
  constructor(
    readonly storeSlug: StoreSlug,
    private readonly snapshots: ProductSnapshot[],
  ) {}

  async *discover(): AsyncGenerator<never, void, void> {}

  async *scrapeCatalog(): AsyncGenerator<ProductSnapshot, void, void> {
    for (const snap of this.snapshots) yield snap;
  }

  async scrapeProduct(): Promise<ProductSnapshot | null> {
    return null;
  }
}

const logger = {
  level: 'silent',
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => logger,
} as unknown as Logger;

async function ingest(slug: StoreSlug, _storeId: number, html: string): Promise<void> {
  const parse = slug === 'dia' ? parseDia : parseCarrefour;
  const adapter = new SnapshotAdapter(slug, parse(html));
  const pipeline = new IngestPipeline(db!, logger);
  const summary = await pipeline.run(adapter, {
    runId: `it-${slug}-${Date.now()}`,
    correlationId: 'integration',
    browser: {} as never,
    signal: new AbortController().signal,
  });
  expect(summary.status).toBe('success');
  expect(summary.storeSlug).toBe(slug);
}

beforeAll(async () => {
  const envUrl = process.env.DATABASE_URL;
  try {
    if (envUrl) {
      await migrate({ databaseUrl: envUrl, dir: MIGRATIONS_DIR, direction: 'up' });
      pool = new Pool({ connectionString: envUrl, max: 5 });
      db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    } else {
      const testDb: TestDb = await startTestDb();
      db = testDb.db;
      containerStop = testDb.stop;
    }
    dbDisponible = true;
  } catch (err) {
    console.warn(`[skip] sin Postgres disponible para integración: ${String(err)}`);
  }
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await pool?.end();
  await containerStop?.();
});

describe('ingesta end-to-end del pipeline contra PostgreSQL real', () => {
  afterEach(async () => {
    if (!db) return;
    await sql`truncate table price_record, match_link, store_sku, product, category, run_report cascade`.execute(
      db,
    );
  });

  it('procesa y persiste los snapshots de DIA validando checksum EAN', async (ctx) => {
    if (!dbDisponible) ctx.skip();
    await db
      .insertInto('store')
      .values({
        slug: 'dia',
        base_url: 'https://diaonline.supermercadosdia.com.ar/',
        config: {},
        is_active: true,
      })
      .onConflict((oc) => oc.column('slug').doUpdateSet({ is_active: true }))
      .returning('id')
      .executeTakeFirstOrThrow();

    const snaps = parseDia(readFileSync(DIA_FIXTURE, 'utf8'));
    expect(snaps.length).toBeGreaterThanOrEqual(8);

    await ingest('dia', 1, readFileSync(DIA_FIXTURE, 'utf8'));

    const skus = await db.selectFrom('store_sku').selectAll().execute();
    expect(skus.length).toBe(snaps.length);

    const prices = await db.selectFrom('price_record').selectAll().execute();
    expect(prices.length).toBe(snaps.length);

    const eansValidos = snaps.filter((s) => s.ean !== undefined).length;
    const conEan = skus.filter((s) => s.declared_ean !== null).length;
    expect(conEan).toBe(eansValidos);

    const report = await db.selectFrom('run_report').selectAll().execute();
    expect(report.length).toBe(1);
    expect(report[0]!.status).toBe('success');
    expect(report[0]!.skus_captured).toBe(snaps.length);
  });

  it('es idempotente: re-ingerir los mismos snapshots no duplica price_records', async (ctx) => {
    if (!dbDisponible) ctx.skip();
    const diaId = (
      await db
        .insertInto('store')
        .values({
          slug: 'dia',
          base_url: 'https://diaonline.supermercadosdia.com.ar/',
          config: {},
          is_active: true,
        })
        .onConflict((oc) => oc.column('slug').doUpdateSet({ is_active: true }))
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    await ingest('dia', diaId, readFileSync(DIA_FIXTURE, 'utf8'));
    const primera = (await db.selectFrom('price_record').selectAll().execute()).length;

    await ingest('dia', diaId, readFileSync(DIA_FIXTURE, 'utf8'));
    const segunda = (await db.selectFrom('price_record').selectAll().execute()).length;

    expect(segunda).toBe(primera);
  });

  it('vincula por EAN productos compartidos entre DIA y Carrefour', async (ctx) => {
    if (!dbDisponible) ctx.skip();
    const diaId = (
      await db
        .insertInto('store')
        .values({
          slug: 'dia',
          base_url: 'https://diaonline.supermercadosdia.com.ar/',
          config: {},
          is_active: true,
        })
        .onConflict((oc) => oc.column('slug').doUpdateSet({ is_active: true }))
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const c4Id = (
      await db
        .insertInto('store')
        .values({
          slug: 'carrefour',
          base_url: 'https://www.carrefour.com.ar/',
          config: {},
          is_active: true,
        })
        .onConflict((oc) => oc.column('slug').doUpdateSet({ is_active: true }))
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    await ingest('dia', diaId, readFileSync(DIA_FIXTURE, 'utf8'));
    await ingest('carrefour', c4Id, readFileSync(C4_FIXTURE, 'utf8'));

    const rows = await sql<{ product_id: number; stores: number; method: string }>`
      select ml.product_id::int as product_id,
             count(distinct ss.store_id)::int as stores,
             min(ml.method) as method
      from match_link ml
      join store_sku ss on ss.id = ml.store_sku_id
      group by ml.product_id
      having count(distinct ss.store_id) >= 2
    `.execute(db);

    expect(rows.rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.rows.every((r) => r.method === 'ean')).toBe(true);

    const products = await db.selectFrom('product').select('id').execute();
    const skus = await db.selectFrom('store_sku').select('id').execute();
    expect(products.length).toBeLessThan(skus.length);
  });
});
