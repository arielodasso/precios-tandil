import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'node-pg-migrate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Logger } from 'pino';
import type { FastifyInstance } from 'fastify';
import type { DB, StoreSlug } from '@precios/shared';
import { startTestDb, type TestDb } from '../helpers/db.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, 'db/migrations');

let pool: Pool | null = null;
let db: Kysely<DB> | null = null;
let containerStop: (() => Promise<void>) | null = null;
let dbDisponible = false;
let app: FastifyInstance | null = null;
let connectionString: string | null = null;

const logger = {
  level: 'silent',
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => logger,
} as unknown as Logger;

const HORA = 3_600_000;
const DIA_MS = 24 * HORA;

async function insertStore(slug: StoreSlug): Promise<number> {
  const row = await db!
    .insertInto('store')
    .values({
      slug,
      name: slug.toUpperCase(),
      base_url: `https://${slug}.example.com/`,
      adapter_id: slug,
      config: {},
      is_active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return Number(row.id);
}

async function insertProducto(values: {
  slug: string;
  canonicalName: string;
  brand?: string;
  ean?: string;
}): Promise<number> {
  const row = await db!
    .insertInto('product')
    .values({
      slug: values.slug,
      canonical_name: values.canonicalName,
      brand: values.brand ?? null,
      ean: values.ean ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return Number(row.id);
}

async function insertOferta(values: {
  storeId: number;
  externalId: string;
  productId: number;
  amount: number;
  ageMs: number;
  promo?: boolean;
}): Promise<void> {
  const sku = await db!
    .insertInto('store_sku')
    .values({
      store_id: values.storeId,
      external_id: values.externalId,
      url: `https://tienda.example.com/${values.externalId}/p`,
      raw_description: 'sku prueba',
      last_seen_at: new Date(Date.now() - HORA),
      is_active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await db!
    .insertInto('match_link')
    .values({
      store_sku_id: Number(sku.id),
      product_id: values.productId,
      method: 'ean',
      score: '1.0000',
      status: 'auto',
    })
    .execute();

  await db!
    .insertInto('price_record')
    .values({
      store_sku_id: Number(sku.id),
      price_amount: values.amount.toFixed(2),
      currency: 'ARS',
      list_or_promo: values.promo ? 'promo' : 'list',
      source_url: `https://tienda.example.com/${values.externalId}/p`,
      captured_at: new Date(Date.now() - values.ageMs),
      run_id: 'it-products',
      is_suspect: false,
    })
    .execute();
}

async function seedMixto(): Promise<number> {
  const diaId = await insertStore('dia');
  const carrefourId = await insertStore('carrefour');
  const veaId = await insertStore('vea');

  const p1 = await insertProducto({
    slug: 'arroz-gallo-oro-1kg',
    canonicalName: 'Arroz Gallo Oro 1kg',
    brand: 'Gallo',
    ean: '7790070431486',
  });

  await insertOferta({
    storeId: diaId,
    externalId: 'd1',
    productId: p1,
    amount: 1500,
    ageMs: 14 * HORA,
  });
  await insertOferta({
    storeId: carrefourId,
    externalId: 'c1',
    productId: p1,
    amount: 1600,
    ageMs: 20 * HORA,
  });
  // Vea con precio viejo (>7 días): aparece flaggeado stale pero fuera del summary
  await insertOferta({
    storeId: veaId,
    externalId: 'v1',
    productId: p1,
    amount: 1000,
    ageMs: 10 * DIA_MS,
  });

  return p1;
}

async function seedSoloRancio(): Promise<number> {
  const diaId = await insertStore('dia');
  const p2 = await insertProducto({
    slug: 'yerba-playadito-1kg',
    canonicalName: 'Yerba Playadito 1kg',
  });
  await insertOferta({
    storeId: diaId,
    externalId: 'd-yerba',
    productId: p2,
    amount: 2400,
    ageMs: 9 * DIA_MS,
  });
  return p2;
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

describe('GET /api/v1/products/:slug contra PostgreSQL real', () => {
  afterEach(async () => {
    if (!db) return;
    await db.deleteFrom('price_aggregate').execute();
    await db.deleteFrom('deal_publication').execute();
    await db.deleteFrom('deal_candidate').execute();
    await db.deleteFrom('price_record').execute();
    await db.deleteFrom('match_link').execute();
    await db.deleteFrom('store_sku').execute();
    await db.deleteFrom('product').execute();
    await db.deleteFrom('category').execute();
    await db.deleteFrom('store').execute();
  });

  it('devuelve 404 not_found para slugs inexistentes', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/products/no-existe-nada',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  }, 30_000);

  it('arma la tarjeta: ofertas asc, stale flaggeado y excluido del summary', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    await seedMixto();

    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/products/arroz-gallo-oro-1kg',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.slug).toBe('arroz-gallo-oro-1kg');
    expect(body.name).toBe('Arroz Gallo Oro 1kg');
    expect(body.brand).toBe('Gallo');
    expect(body.ean).toBe(7790070431486);

    expect(body.offers.length).toBe(3);
    expect(body.offers.map((o: { store: string }) => o.store)).toEqual(['vea', 'dia', 'carrefour']);
    expect(body.offers[0].is_stale).toBe(true);
    expect(body.offers[1].is_stale).toBe(false);
    expect(body.offers[1].price).toBe(1500);
    expect(body.offers[1].freshness_hours).toBeGreaterThanOrEqual(13);

    expect(body.summary.best_store).toBe('dia');
    expect(body.summary.best_price).toBe(1500);
    expect(body.summary.worst_price).toBe(1600);
    expect(body.summary.spread_pct).toBeCloseTo(6.7, 1);
    expect(body.stale_notice).toBeUndefined();
  }, 30_000);

  it('producto solo con datos rancios: offers vacío + stale_notice', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    await seedSoloRancio();

    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/products/yerba-playadito-1kg',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.offers).toEqual([]);
    expect(typeof body.stale_notice).toBe('string');
    expect(body.summary.best_store).toBeNull();
  }, 30_000);
});
