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

async function insertStore(slug: StoreSlug): Promise<number> {
  const row = await db!
    .insertInto('store')
    .values({
      slug,
      base_url: `https://${slug}.example.com/`,
      adapter_id: slug,
      config: {},
      is_active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return Number(row.id);
}

interface CategoriaSpec {
  slug: string;
  name: string;
  parentId?: number | null;
  path: string;
}

async function insertCategoria(spec: CategoriaSpec): Promise<number> {
  const row = await db!
    .insertInto('category')
    .values({
      slug: spec.slug,
      name: spec.name,
      parent_id: spec.parentId ?? null,
      path: spec.path,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return Number(row.id);
}

async function insertProducto(values: {
  slug: string;
  canonicalName: string;
  brand?: string;
  categoryId?: number | null;
}): Promise<number> {
  const row = await db!
    .insertInto('product')
    .values({
      slug: values.slug,
      canonical_name: values.canonicalName,
      brand: values.brand ?? null,
      category_id: values.categoryId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return Number(row.id);
}

async function insertOfertaFresca(values: {
  storeId: number;
  externalId: string;
  productId: number;
  amount: number;
  ageMs: number;
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
      list_or_promo: 'list',
      source_url: `https://tienda.example.com/${values.externalId}/p`,
      captured_at: new Date(Date.now() - values.ageMs),
      run_id: 'it-search',
      is_suspect: false,
    })
    .execute();
}

async function seedEscenario(): Promise<{ arrozGallo: number }> {
  const diaId = await insertStore('dia');
  const carrefourId = await insertStore('carrefour');
  await insertStore('vea');

  const almacenId = await insertCategoria({ slug: 'almacen', name: 'Almacén', path: 'almacen' });
  const arrozCatId = await insertCategoria({
    slug: 'arroz',
    name: 'Arroz',
    parentId: almacenId,
    path: 'almacen/arroz',
  });
  const yerbaCatId = await insertCategoria({
    slug: 'yerba',
    name: 'Yerba',
    parentId: almacenId,
    path: 'almacen/yerba',
  });

  const arrozGallo = await insertProducto({
    slug: 'arroz-gallo-oro-1kg',
    canonicalName: 'Arroz Gallo Oro 1kg',
    brand: 'Gallo',
    categoryId: arrozCatId,
  });
  const parboil = await insertProducto({
    slug: 'arroz-parboil-dia-1kg',
    canonicalName: 'Arroz Parboil DIA 1kg',
    brand: 'DIA',
    categoryId: arrozCatId,
  });
  const playadito = await insertProducto({
    slug: 'yerba-playadito-1kg',
    canonicalName: 'Yerba Playadito 1kg',
    brand: 'Playadito',
    categoryId: yerbaCatId,
  });

  await insertOfertaFresca({
    storeId: diaId,
    externalId: 'd-arroz',
    productId: arrozGallo,
    amount: 1590,
    ageMs: 14 * HORA,
  });
  await insertOfertaFresca({
    storeId: carrefourId,
    externalId: 'c-arroz',
    productId: arrozGallo,
    amount: 1899,
    ageMs: 20 * HORA,
  });
  await insertOfertaFresca({
    storeId: diaId,
    externalId: 'd-parboil',
    productId: parboil,
    amount: 1450,
    ageMs: 5 * HORA,
  });
  await insertOfertaFresca({
    storeId: diaId,
    externalId: 'd-yerba',
    productId: playadito,
    amount: 2400,
    ageMs: 48 * HORA,
  });

  return { arrozGallo };
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

describe('GET /api/v1/search contra PostgreSQL real', () => {
  afterEach(async () => {
    if (!db) return;
    await db.deleteFrom('price_aggregate').execute();
    await db.deleteFrom('price_record').execute();
    await db.deleteFrom('match_link').execute();
    await db.deleteFrom('store_sku').execute();
    await db.deleteFrom('product').execute();
    await db.deleteFrom('category').execute();
    await db.deleteFrom('store').execute();
  });

  it('devuelve resultados con el shape del contrato y ranking por relevancia', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    await seedEscenario();

    const { refreshAggregates } = await import('../../apps/worker/src/jobs/refresh-aggregates.ts');
    await refreshAggregates(db!, logger);

    const res = await app!.inject({ method: 'GET', url: '/api/v1/search?q=arroz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.results.length).toBe(2);
    // mayor similitud de trigramas con "arroz" primero; empates resueltos por best_price asc
    expect(body.results[0].slug).toBe('arroz-gallo-oro-1kg');
    expect(body.results[0].best_price).toBe(1590);
    expect(body.results[1].slug).toBe('arroz-parboil-dia-1kg');
    expect(typeof body.results[0].name).toBe('string');
    expect(body.results[0].category).toBe('almacen/arroz');
    expect(body.results[0].stores_count).toBeGreaterThanOrEqual(1);
    expect(typeof body.results[0].freshest_captured_at).toBe('string');
    expect(new Date(body.results[0].freshest_captured_at).toString()).not.toBe('Invalid Date');
  }, 30_000);

  it('tolera typos vía trigramas', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    await seedEscenario();
    await refreshAggregates(db!, logger);

    const res = await app!.inject({ method: 'GET', url: '/api/v1/search?q=aros%20gallo' });
    expect(res.statusCode).toBe(200);
    const slugs = res.json().results.map((r: { slug: string }) => r.slug);
    expect(slugs).toContain('arroz-gallo-oro-1kg');
  }, 30_000);

  it('filtra por tienda y por categoría (subtree)', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    await seedEscenario();
    await refreshAggregates(db!, logger);

    const porTienda = await app!.inject({
      method: 'GET',
      url: '/api/v1/search?q=yerba&store=carrefour',
    });
    expect(porTienda.json().results.length).toBe(0);

    const porTiendaDia = await app!.inject({
      method: 'GET',
      url: '/api/v1/search?q=yerba&store=dia',
    });
    expect(porTiendaDia.json().results.length).toBe(1);

    const porPadre = await app!.inject({
      method: 'GET',
      url: '/api/v1/search?q=arroz&category=almacen',
    });
    expect(porPadre.json().results.length).toBe(2);

    const porHermana = await app!.inject({
      method: 'GET',
      url: '/api/v1/search?q=arroz&category=almacen/yerba',
    });
    expect(porHermana.json().results.length).toBe(0);

    const desconocida = await app!.inject({
      method: 'GET',
      url: '/api/v1/search?q=arroz&category=no-existe',
    });
    expect(desconocida.statusCode).toBe(200);
    expect(desconocida.json().results).toEqual([]);
  }, 30_000);

  it('pagina con next_cursor sin duplicados', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    await seedEscenario();
    await refreshAggregates(db!, logger);

    const page1 = await app!.inject({
      method: 'GET',
      url: '/api/v1/search?q=arroz&limit=1',
    });
    const body1 = page1.json();
    expect(body1.results.length).toBe(1);
    expect(body1.next_cursor).toBeTruthy();

    const page2 = await app!.inject({
      method: 'GET',
      url: `/api/v1/search?q=arroz&limit=1&cursor=${encodeURIComponent(body1.next_cursor)}`,
    });
    const body2 = page2.json();
    expect(body2.results.length).toBe(1);
    expect(body2.results[0].slug).not.toBe(body1.results[0].slug);
  }, 30_000);
});
