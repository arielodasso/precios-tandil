import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '@precios/shared';

export function createDb(databaseUrl: string): Kysely<DB> {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
