import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'node-pg-migrate';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '@precios/shared';

export interface TestDb {
  connectionString: string;
  db: Kysely<DB>;
  stop(): Promise<void>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'db', 'migrations');

export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine',
  ).start();

  const connectionString = container.getConnectionUri();

  await migrate({ databaseUrl: connectionString, dir: MIGRATIONS_DIR, direction: 'up' });

  const pool = new Pool({ connectionString, max: 5 });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  return {
    connectionString,
    db,
    async stop() {
      await db.destroy();
      await container.stop();
    },
  };
}
