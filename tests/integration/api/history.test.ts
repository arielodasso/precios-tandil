import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'node-pg-migrate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { DB } from '@precios/shared';
import { startTestDb, type TestDb } from '../helpers/db.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, 'db/migrations');

let pool: Pool | null = null;
let db: Kysely<DB> | null = null;
let containerStop: (() => Promise<void>) | null = null;
let dbDisponible = false;
let app: FastifyInstance | null = null;
let connectionString: string | null = null;

async function seedSerie90Dias(): Promise<string> {
  const store = await db!
    .insertInto('store')
    .values({
      slug: 'dia',
      base_url: 'https://dia.example.com/',
      adapter_id: 'dia',
      config: {},
      is_active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const product = await db!
    .insertInto('product')
    .values({ slug: 'arroz-gallo-90d', canonical_name: 'Arroz Gallo Oro 1kg' })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();

  const sku = await db!
    .insertInto('store_sku')
    .values({
      store_id: Number(store.id),
      external_id: 'd-arroz-90',
      url: 'https://dia.example.com/arroz/p',
      raw_description: 'arroz gallo 1kg',
      last_seen_at: new Date(),
      is_active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await db!
    .insertInto('match_link')
    .values({
      store_sku_id: Number(sku.id),
      product_id: Number(product.id),
      method: 'ean',
      score: '1.0000',
      status: 'auto',
    })
    .execute();

  // Serie sintética: un precio por día durante 90 días (1500 → 1589)
  const now = new Date();
  const values = Array.from({ length: 90 }, (_, i) => {
    const capturedAt = new Date(now.getTime() - (89 - i) * 86_400_000);
    return {
      store_sku_id: Number(sku.id),
      price_amount: (1500 + i).toFixed(2),
      currency: 'ARS',
      list_or_promo: 'list' as const,
      source_url: 'https://dia.example.com/arroz/p',
      captured_at: capturedAt,
      run_id: 'it-history',
      is_suspect: false,
    };
  });
  await db!.insertInto('price_record').values(values).execute();

  return String(product.slug);
}

beforeAll(async () => {
  const envUrl = process.env.DATABASE_URL;
  try {
    if (envUrl) {
      connectionString = envUrl;
      await migrate({ databaseUrl: envUrl, dir: MIGRATIONS_DIR, direction: 'up' });
      pool = new Pool({ connectionString: envUrl, max: 5 });
      db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    } else {
      const testDb: TestDb = await startTestDb();
      db = testDb.db;
      connectionString = testDb.connectionString;
      containerStop = testDb.stop;
    }

    const { buildApp } = await import('../../apps/api/src/app.ts');
    app = buildApp({
      PORT: 0,
      DATABASE_URL: connectionString,
      NODE_ENV: 'test',
    });
    await app.ready();
    dbDisponible = true;
  } catch (err) {
    console.warn(`[skip] sin Postgres disponible para integración: ${String(err)}`);
  }
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db?.destroy();
  await pool?.end();
  await containerStop?.();
});

describe('GET /api/v1/products/:slug/history contra PostgreSQL real', () => {
  afterEach(async () => {
    if (!db) return;
    await sql`truncate table daily_series`.execute(db);
    await db.deleteFrom('price_aggregate').execute();
    await db.deleteFrom('price_record').execute();
    await db.deleteFrom('match_link').execute();
    await db.deleteFrom('store_sku').execute();
    await db.deleteFrom('product').execute();
    await db.deleteFrom('store').execute();
  });

  it('sirve la serie diaria de 90 días desde daily_series con stats coherentes', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    const slug = await seedSerie90Dias();

    const { refreshDailySeries } =
      await import('../../apps/worker/src/jobs/refresh-daily-series.ts');
    const { refreshAggregates } = await import('../../apps/worker/src/jobs/refresh-aggregates.ts');
    await refreshAggregates(db, undefined);
    await refreshDailySeries(db, undefined);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${slug}/history?window=90`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.product_slug).toBe(slug);
    expect(body.series).toHaveLength(90);
    expect(body.series[0].min_price).toBe(1500);
    expect(body.series[89].min_price).toBe(1589);
    expect(body.insufficient_history).toBe(false);
    expect(body.stats.min_window).toBe(1500);
    expect(body.stats.max_window).toBe(1589);
    expect(typeof body.stats.pct_change_7d).toBe('number');
  }, 30_000);

  it('window=30 limita la serie y window inválido da 400', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    const slug = await seedSerie90Dias();

    const { refreshDailySeries } =
      await import('../../apps/worker/src/jobs/refresh-daily-series.ts');
    await refreshDailySeries(db, undefined);

    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${slug}/history?window=30`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().series.length).toBeLessThanOrEqual(31);

    const bad = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${slug}/history?window=7`,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_query');

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/products/inexistente/history?window=30',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('not_found');
  }, 30_000);
});
