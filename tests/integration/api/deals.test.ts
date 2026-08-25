import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'node-pg-migrate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
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

async function seedEscenario(): Promise<void> {
  const dia = await db!
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
  const carrefour = await db!
    .insertInto('store')
    .values({
      slug: 'carrefour',
      base_url: 'https://carrefour.example.com/',
      adapter_id: 'carrefour',
      config: {},
      is_active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const producto = await db!
    .insertInto('product')
    .values({ slug: 'aceite-girasol-900ml', canonical_name: 'Aceite Girasol 900ml' })
    .returning('id')
    .executeTakeFirstOrThrow();

  for (const [idx, storeId] of [Number(dia.id), Number(carrefour.id)].entries()) {
    const sku = await db!
      .insertInto('store_sku')
      .values({
        store_id: storeId,
        external_id: `sku-aceite-${idx}`,
        url: `https://tienda.example.com/aceite-${idx}/p`,
        raw_description: 'aceite girasol',
        last_seen_at: new Date(),
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db!
      .insertInto('match_link')
      .values({
        store_sku_id: Number(sku.id),
        product_id: Number(producto.id),
        method: 'ean',
        score: '1.0000',
        status: 'auto',
      })
      .execute();

    await db!
      .insertInto('price_record')
      .values({
        store_sku_id: Number(sku.id),
        price_amount: (2000 + idx * 100).toFixed(2),
        currency: 'ARS',
        list_or_promo: 'list',
        source_url: `https://tienda.example.com/aceite-${idx}/p`,
        captured_at: new Date(Date.now() - 2 * 3_600_000),
        run_id: 'it-deals',
        is_suspect: false,
      })
      .execute();
  }
}

async function crearCandidatoPendiente(): Promise<number> {
  const product = await db!
    .selectFrom('product')
    .select('id')
    .where('slug', '=', 'aceite-girasol-900ml')
    .executeTakeFirstOrThrow();

  await db!
    .insertInto('price_aggregate')
    .values({
      product_id: Number(product.id),
      best_price: '1200.00',
      stores_count: 2,
      refreshed_at: new Date(),
      avg_30d: '1800.00',
    })
    .onConflict((oc) => oc.column('product_id').doUpdateSet({ best_price: '1200.00' }))
    .execute();

  const candidate = await db!
    .insertInto('deal_candidate')
    .values({
      product_id: Number(product.id),
      detected_at: new Date(),
      discount_pct: '33.33',
      evidence: JSON.stringify({ best_price: 1200, avg_30d: 1800 }),
      status: 'pending',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return Number(candidate.id);
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

describe('flujo deal candidate → publish → visible en /deals', () => {
  let adminTokenHash: string;

  beforeAll(async () => {
    if (!db) return;
    adminTokenHash = Array.from(new TextEncoder().encode('token-admin-test'))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const crypto = await import('node:crypto');
    adminTokenHash = crypto.createHash('sha256').update('token-admin-test').digest('hex');
  });

  afterEach(async () => {
    if (!db) return;
    await db.deleteFrom('deal_publication').execute();
    await db.deleteFrom('deal_candidate').execute();
    await db.deleteFrom('price_aggregate').execute();
    await db.deleteFrom('price_record').execute();
    await db.deleteFrom('match_link').execute();
    await db.deleteFrom('store_sku').execute();
    await db.deleteFrom('product').execute();
    await db.deleteFrom('store').execute();
    await db.deleteFrom('admin_token').execute();
  });

  it('publica una candidata y aparece en /deals con badge', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    await seedEscenario();
    await db!
      .insertInto('admin_token')
      .values({ label: 'test-admin', token_hash: adminTokenHash, role: 'admin' })
      .execute();

    // sin publicaciones aún → lista vacía
    const antes = await app!.inject({ method: 'GET', url: '/api/v1/deals?status=published' });
    expect(antes.statusCode).toBe(200);
    expect(antes.json().deals).toEqual([]);

    const candidateId = await crearCandidatoPendiente();

    // sin token → 401
    const noAuth = await app!.inject({
      method: 'POST',
      url: `/api/v1/admin/deals/candidates/${candidateId}/publish`,
      payload: {},
    });
    expect(noAuth.statusCode).toBe(401);

    const publish = await app!.inject({
      method: 'POST',
      url: `/api/v1/admin/deals/candidates/${candidateId}/publish`,
      headers: { authorization: 'Bearer token-admin-test' },
      payload: { badge: 'gold' },
    });
    expect(publish.statusCode).toBe(200);

    const despues = await app!.inject({
      method: 'GET',
      url: '/api/v1/deals?status=published',
    });
    expect(despues.statusCode).toBe(200);
    const deals = despues.json().deals;
    expect(deals).toHaveLength(1);
    expect(deals[0].slug).toBe('aceite-girasol-900ml');
    expect(deals[0].badge).toBe('gold');
    expect(deals[0].price).toBe(1200);
  }, 60_000);

  it('rechazar marca rejected_until a +14 días y el público no la ve', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    await seedEscenario();
    await db!
      .insertInto('admin_token')
      .values({ label: 'test-admin', token_hash: adminTokenHash, role: 'admin' })
      .execute();

    const candidateId = await crearCandidatoPendiente();
    const reject = await app!.inject({
      method: 'POST',
      url: `/api/v1/admin/deals/candidates/${candidateId}/reject`,
      headers: { authorization: 'Bearer token-admin-test' },
      payload: {},
    });
    expect(reject.statusCode).toBe(200);

    const row = await db!
      .selectFrom('deal_candidate')
      .select(['status', 'rejected_until'])
      .where('id', '=', candidateId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('rejected');
    const until = new Date(row.rejected_until as unknown as string);
    const days = (until.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    const deals = await app!.inject({ method: 'GET', url: '/api/v1/deals' });
    expect(deals.json().deals).toHaveLength(0);
  }, 60_000);
});
