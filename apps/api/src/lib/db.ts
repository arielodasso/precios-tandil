import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '@precios/shared';

export function createDb(databaseUrl: string): Kysely<DB> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 30000, // Da 30s al pooler para responder la verificación (evita EAUTHQUERY timeout)
    idleTimeoutMillis: 30000,
    ssl: databaseUrl.includes('sslmode') ? { rejectUnauthorized: false } : undefined,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
