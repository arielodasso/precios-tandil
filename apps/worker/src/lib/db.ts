import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '@precios/shared';

export function createDb(databaseUrl: string): Kysely<DB> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    ssl: databaseUrl.includes('sslmode') ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (err) => {
    console.error('pg pool error (ignorado):', err.message);
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
