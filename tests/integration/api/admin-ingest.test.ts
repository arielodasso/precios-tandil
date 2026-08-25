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

async function seedStore(slug: string): Promise<number> {
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

describe('admin ingest endpoints', () => {
  beforeAll(async () => {
    if (!db) return;
    await db
      .insertInto('admin_token')
      .values({ label: 'test-admin', token_hash: adminTokenHash, role: 'admin' })
      .execute();
  });

  afterEach(async () => {
    if (!db) return;
    await db.deleteFrom('run_report').execute();
    await db.deleteFrom('store').execute();
  });

  it('GET /admin/ingest/runs requiere auth', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/admin/ingest/runs' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /admin/ingest/runs retorna lista vacía sin datos', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/ingest/runs',
      headers: { authorization: 'Bearer token-admin-test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().runs).toEqual([]);
  });

  it('GET /admin/ingest/runs retorna corridas existentes', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    const storeId = await seedStore('dia');

    await db!
      .insertInto('run_report')
      .values({
        run_id: 'run-test-001',
        store_id: storeId,
        started_at: new Date(),
        status: 'completed',
        skus_captured: 42,
        skus_rejected: 3,
        http_errors: 0,
        quarantined: false,
        correlation_id: 'corr-001',
      })
      .execute();

    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/ingest/runs',
      headers: { authorization: 'Bearer token-admin-test' },
    });
    expect(res.statusCode).toBe(200);
    const runs = res.json().runs;
    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe('run-test-001');
    expect(runs[0].store_slug).toBe('dia');
    expect(runs[0].skus_captured).toBe(42);
    expect(runs[0].skus_rejected).toBe(3);
    expect(runs[0].quarantined).toBe(false);
  });

  it('POST /admin/ingest/stores/:slug/retry requiere auth', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest/stores/dia/retry',
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /admin/ingest/stores/:slug/retry 404 si tienda no existe', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest/stores/noexiste/retry',
      headers: { authorization: 'Bearer token-admin-test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /admin/ingest/stores/:slug/retry 400 si tienda desactivada', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    await db!
      .insertInto('store')
      .values({
        slug: 'inactiva',
        base_url: 'https://inactiva.example.com/',
        adapter_id: 'inactiva',
        config: {},
        is_active: false,
      })
      .execute();

    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest/stores/inactiva/retry',
      headers: { authorization: 'Bearer token-admin-test' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('POST /admin/ingest/stores/:slug/retry 409 si corrida en curso', async (ctx) => {
    if (!dbDisponible || !app || !db) ctx.skip();
    const storeId = await seedStore('carrefour');

    await db!
      .insertInto('run_report')
      .values({
        run_id: 'run-active',
        store_id: storeId,
        started_at: new Date(),
        status: 'running',
        skus_captured: 0,
        skus_rejected: 0,
        http_errors: 0,
        quarantined: false,
        correlation_id: 'corr-active',
      })
      .execute();

    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest/stores/carrefour/retry',
      headers: { authorization: 'Bearer token-admin-test' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('run_in_progress');
  });

  it('POST /admin/ingest/stores/:slug/retry 500 si pg-boss no está configurado', async (ctx) => {
    if (!dbDisponible || !app) ctx.skip();
    await seedStore('vea');

    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest/stores/vea/retry',
      headers: { authorization: 'Bearer token-admin-test' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('internal_error');
  });
});
