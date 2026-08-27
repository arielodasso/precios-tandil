import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '@precios/shared';

let _db: Kysely<DB> | null = null;

export function getDb(): Kysely<DB> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no configurada');
  const pool = new Pool({
    connectionString: url,
    max: 5,
    ssl: url.includes('sslmode') ? { rejectUnauthorized: false } : undefined,
  });
  _db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return _db;
}
