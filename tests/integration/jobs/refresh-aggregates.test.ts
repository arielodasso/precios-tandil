import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'node-pg-migrate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Logger } from 'pino';
import type { DB, StoreSlug } from '@precios/shared';
import { startTestDb, type TestDb } from '../helpers/db.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, 'db/migrations');

let pool: Pool | null = null;
let db: Kysely<DB> | null = null;
let containerStop: (() => Promise<void>) | null = null;
let dbDisponible = false;

const logger = {
  level: 'silent',
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => logger,
} as unknown as Logger;

const NOW = new Date('2026-08-24T12:00:00.000Z');
const HORA = 3_600_000;
const DIA_MS = 24 * HORA;

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

interface SkuSpec {
  storeId: number;
  externalId: string;
  productId: number;
  status?: 'auto' | 'rejected';
  precios: Array<{ amount: number; ageMs: number; promo?: boolean; suspect?: boolean }>;
}

async function insertSku(spec: SkuSpec): Promise<void> {
  const sku = await db!
    .insertInto('store_sku')
    .values({
      store_id: spec.storeId,
      external_id: spec.externalId,
      url: `https://tienda.example.com/${spec.externalId}/p`,
      raw_description: `producto prueba ${spec.externalId}`,
      last_seen_at: new Date(NOW.getTime() - HORA),
      is_active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await db!
    .insertInto('match_link')
    .values({
      store_sku_id: Number(sku.id),
      product_id: spec.productId,
      method: 'ean',
      score: '1.0000',
      status: spec.status ?? 'auto',
    })
    .execute();

  for (const p of spec.precios) {
    await db!
      .insertInto('price_record')
      .values({
        store_sku_id: Number(sku.id),
        price_amount: p.amount.toFixed(2),
        currency: 'ARS',
        list_or_promo: p.promo ? 'promo' : 'list',
        source_url: `https://tienda.example.com/${spec.externalId}/p`,
        captured_at: new Date(NOW.getTime() - p.ageMs),
        run_id: 'it-aggregates',
        is_suspect: p.suspect ?? false,
      })
      .onConflict((oc) => oc.columns(['store_sku_id', 'captured_at', 'list_or_promo']).doNothing())
      .execute();
  }
}

async function insertProduct(slug: string): Promise<number> {
  const row = await db!
    .insertInto('product')
    .values({ slug, canonical_name: slug.replace(/-/g, ' ') })
    .returning('id')
    .executeTakeFirstOrThrow();
  return Number(row.id);
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

describe('job refresh-aggregates contra PostgreSQL real', () => {
  afterEach(async () => {
    if (!db) return;
    await db.deleteFrom('price_aggregate').execute();
    await db.deleteFrom('price_record').execute();
    await db.deleteFrom('match_link').execute();
    await db.deleteFrom('store_sku').execute();
    await db.deleteFrom('product').execute();
    await db.deleteFrom('run_report').execute();
  });

  async function seedEscenario(): Promise<{
    diaId: number;
    carrefourId: number;
    veaId: number;
    p1: number;
    p2: number;
    p3: number;
  }> {
    const diaId = await insertStore('dia');
    const carrefourId = await insertStore('carrefour');
    const veaId = await insertStore('vea');

    const p1 = await insertProduct('arroz-prueba');
    const p2 = await insertProduct('yerba-rancia');
    const p3 = await insertProduct('aceite-promo');

    // p1: mejor oferta DIA fresca; Carrefour con suspect más barato excluido; Vea rechazado.
    await insertSku({
      storeId: diaId,
      externalId: 'd1',
      productId: p1,
      precios: [
        { amount: 2000, ageMs: 10 * DIA_MS },
        { amount: 1500, ageMs: 2 * HORA },
      ],
    });
    await insertSku({
      storeId: carrefourId,
      externalId: 'c1',
      productId: p1,
      precios: [
        { amount: 1600, ageMs: 3 * HORA },
        { amount: 1200, ageMs: 1 * HORA, suspect: true },
      ],
    });
    await insertSku({
      storeId: veaId,
      externalId: 'v1',
      productId: p1,
      status: 'rejected',
      precios: [{ amount: 100, ageMs: 1 * HORA }],
    });

    // p2: solo datos rancios (>7 días) → no debe tener agregado.
    await insertSku({
      storeId: diaId,
      externalId: 'd2',
      productId: p2,
      precios: [{ amount: 9000, ageMs: 8 * DIA_MS }],
    });

    // p3: list y promo al mismo captured_at → gana la promo.
    const t0 = 4 * HORA;
    await insertSku({
      storeId: carrefourId,
      externalId: 'c3',
      productId: p3,
      precios: [
        { amount: 1800, ageMs: t0 },
        { amount: 1700, ageMs: t0, promo: true },
      ],
    });

    return { diaId, carrefourId, veaId, p1, p2, p3 };
  }

  it('calcula best_price/stores_count/frescura excluyendo suspects y matches rechazados', async (ctx) => {
    if (!dbDisponible) ctx.skip();
    const { diaId, p1, p3 } = await seedEscenario();

    const { refreshAggregates } =
      await import('../../../apps/worker/src/jobs/refresh-aggregates.ts');
    const result = await refreshAggregates(db!, logger, { now: NOW });

    expect(result.refreshedAt).toEqual(NOW);
    expect(result.productsUpdated).toBe(2); // p1 y p3; p2 sin datos frescos
    expect(result.productsRemoved).toBe(0);

    const aggs = await db!.selectFrom('price_aggregate').selectAll().execute();
    const byProduct = new Map(aggs.map((a) => [a.product_id, a] as const));

    const agg1 = byProduct.get(p1)!;
    expect(agg1).toBeDefined();
    expect(Number(agg1.best_price)).toBe(1500);
    expect(agg1.best_store_id).toBe(diaId);
    expect(agg1.stores_count).toBe(2);
    expect(agg1.best_captured_at).toEqual(new Date(NOW.getTime() - 2 * HORA));
    // métricas históricas (T051): dia 2000@10d+1500@2h, c4 1600@3h (1200 suspect excluido), vea rechazado
    expect(Number(agg1.min_30d)).toBe(1500);
    expect(Number(agg1.min_90d)).toBe(1500);
    expect(Number(agg1.min_all_time)).toBe(1500);
    expect(Number(agg1.avg_30d)).toBeCloseTo(1700, 2);
    // ref ≤24h y ≤7d es el único registro tan viejo: 2000@10d
    expect(Number(agg1.pct_change_24h)).toBe(-25);
    expect(Number(agg1.pct_change_7d)).toBe(-25);

    // p3: promo preferida sobre list al mismo captured_at
    const agg3 = byProduct.get(p3)!;
    expect(Number(agg3.best_price)).toBe(1700);
    expect(agg3.stores_count).toBe(1);
    expect(Number(agg3.min_30d)).toBe(1700);
    expect(Number(agg3.avg_30d)).toBeCloseTo(1750, 2);
    expect(agg3.pct_change_24h).toBeNull(); // sin registros previos a 24h
  }, 30_000);

  it('elimina agregados de productos que se quedan sin datos frescos', async (ctx) => {
    if (!dbDisponible) ctx.skip();
    const { p2 } = await seedEscenario();

    // Agregado preexistente de cuando p2 tenía datos frescos.
    await db!
      .insertInto('price_aggregate')
      .values({
        product_id: p2,
        best_price: '9000.00',
        stores_count: 1,
        refreshed_at: new Date(NOW.getTime() - 9 * DIA_MS),
      })
      .execute();

    const { refreshAggregates } =
      await import('../../../apps/worker/src/jobs/refresh-aggregates.ts');
    const result = await refreshAggregates(db!, logger, { now: NOW });

    expect(result.productsRemoved).toBe(1);
    const rows = await db!
      .selectFrom('price_aggregate')
      .select('product_id')
      .where('product_id', '=', p2)
      .execute();
    expect(rows.length).toBe(0);
  }, 30_000);

  it('es idempotente: refrescar dos veces produce los mismos agregados', async (ctx) => {
    if (!dbDisponible) ctx.skip();
    await seedEscenario();

    const { refreshAggregates } =
      await import('../../../apps/worker/src/jobs/refresh-aggregates.ts');
    await refreshAggregates(db!, logger, { now: NOW });
    const primera = await db!
      .selectFrom('price_aggregate')
      .selectAll()
      .orderBy('product_id')
      .execute();
    await refreshAggregates(db!, logger, { now: NOW });
    const segunda = await db!
      .selectFrom('price_aggregate')
      .selectAll()
      .orderBy('product_id')
      .execute();

    expect(segunda.length).toBe(primera.length);
    for (let i = 0; i < segunda.length; i++) {
      expect(Number(segunda[i]!.best_price)).toBe(Number(primera[i]!.best_price));
      expect(segunda[i]!.best_store_id).toBe(primera[i]!.best_store_id);
      expect(segunda[i]!.stores_count).toBe(primera[i]!.stores_count);
    }
  }, 30_000);
});
