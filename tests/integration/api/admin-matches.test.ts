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
let adminTokenHash = '';

async function seedMatchScenario(): Promise<{ matchId: number; productId: number }> {
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
    .values({ slug: 'arroz-1kg', canonical_name: 'Arroz Largo 1kg' })
    .returning('id')
    .executeTakeFirstOrThrow();

  const sku = await db!
    .insertInto('store_sku')
    .values({
      store_id: Number(store.id),
      external_id: 'sku-arroz-001',
      url: 'https://dia.example.com/arroz/p',
      raw_description: 'arroz largo 1kg',
      last_seen_at: new Date(),
      is_active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const match = await db!
    .insertInto('match_link')
    .values({
      store_sku_id: Number(sku.id),
      product_id: Number(product.id),
      method: 'semantic',
      score: '0.8500',
      status: 'pending_review',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return { matchId: Number(match.id), productId: Number(product.id) };
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

    const crypto = await import('node:crypto');
    adminTokenHash = crypto.createHash('sha256').update('token-admin-test').digest('hex');

    const { buildApp } = await import('../../apps/api/src/app.ts');
    app = buildApp({ PORT: 0, DATABASE_URL: connectionString, NODE_ENV: 'test' });
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

describe('admin matches endpoints', () => {
  beforeAll(async () => {
    if (!db) return;
    await db
      .insertInto('admin_token')
      .values({ label: 'test-admin', token_hash: adminTokenHash, role: 'admin' })
      .execute();
  });

  afterEach(async () => {
    if (!db) return;
    await db.deleteFrom('match_link').execute();
    await db.deleteFrom('store_sku').execute();
    await db.deleteFrom('product').execute();
    await db.deleteFrom('store').execute();
  });

  it('GET /admin/matches/pending requiere auth', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/admin/matches/pending' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /admin/matches/pending retorna lista vacía sin datos', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/matches/pending',
      headers: { authorization: 'Bearer token-admin-test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().matches).toEqual([]);
  });

  it('GET /admin/matches/pending retorna matches pendientes', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    await seedMatchScenario();

    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/matches/pending',
      headers: { authorization: 'Bearer token-admin-test' },
    });
    expect(res.statusCode).toBe(200);
    const matches = res.json().matches;
    expect(matches).toHaveLength(1);
    expect(matches[0].product_slug).toBe('arroz-1kg');
    expect(matches[0].method).toBe('semantic');
    expect(matches[0].sku_ean).toBeNull();
  });

  it('POST /admin/matches/:id/decision requiere auth', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/admin/matches/1/decision',
      payload: { decision: 'confirmed' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /admin/matches/:id/decision 400 si id inválido', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/admin/matches/abc/decision',
      headers: { authorization: 'Bearer token-admin-test' },
      payload: { decision: 'confirmed' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /admin/matches/:id/decision 400 si decision inválida', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    const { matchId } = await seedMatchScenario();
    const res = await app!.inject({
      method: 'POST',
      url: `/api/v1/admin/matches/${matchId}/decision`,
      headers: { authorization: 'Bearer token-admin-test' },
      payload: { decision: 'invalido' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('confirmed');
  });

  it('POST /admin/matches/:id/decision confirma un match pendiente', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    const { matchId } = await seedMatchScenario();

    const res = await app!.inject({
      method: 'POST',
      url: `/api/v1/admin/matches/${matchId}/decision`,
      headers: { authorization: 'Bearer token-admin-test' },
      payload: { decision: 'confirmed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe('confirmed');

    const row = await db!
      .selectFrom('match_link')
      .select(['status', 'decided_by'])
      .where('id', '=', matchId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('confirmed');
    expect(row.decided_by).toBe('test-admin');
  });

  it('POST /admin/matches/:id/decision rechaza un match pendiente', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    const { matchId } = await seedMatchScenario();

    const res = await app!.inject({
      method: 'POST',
      url: `/api/v1/admin/matches/${matchId}/decision`,
      headers: { authorization: 'Bearer token-admin-test' },
      payload: { decision: 'rejected' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe('rejected');

    const row = await db!
      .selectFrom('match_link')
      .select('status')
      .where('id', '=', matchId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('rejected');
  });

  it('POST /admin/matches/:id/decision 404 si match no existe', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/admin/matches/999999/decision',
      headers: { authorization: 'Bearer token-admin-test' },
      payload: { decision: 'confirmed' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /admin/matches/:id/decision 404 si match ya fue decidido', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    const { matchId } = await seedMatchScenario();

    await app!.inject({
      method: 'POST',
      url: `/api/v1/admin/matches/${matchId}/decision`,
      headers: { authorization: 'Bearer token-admin-test' },
      payload: { decision: 'confirmed' },
    });

    const res = await app!.inject({
      method: 'POST',
      url: `/api/v1/admin/matches/${matchId}/decision`,
      headers: { authorization: 'Bearer token-admin-test' },
      payload: { decision: 'rejected' },
    });
    expect(res.statusCode).toBe(404);
  });
});
