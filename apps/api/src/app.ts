import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import { AppError } from '@precios/shared';
import { createDb } from './lib/db.ts';
import { registerCache } from './plugins/cache.ts';
import { registerSecurity } from './plugins/security.ts';
import { searchRoutes } from './routes/v1/search.ts';
import { productRoutes } from './routes/v1/products.ts';
import { taxonomyRoutes } from './routes/v1/taxonomy.ts';
import { historyRoutes } from './routes/v1/history.ts';
import { dealsRoutes } from './routes/v1/deals.ts';
import { adminDealRoutes } from './routes/admin/deals.ts';
import { adminIngestRoutes } from './routes/admin/ingest.ts';
import { adminMatchRoutes } from './routes/admin/matches.ts';
import type { ApiConfig } from './lib/config.ts';
import type { PgBossSender } from './lib/pgboss-sender.ts';
import { registerMetrics } from './plugins/metrics.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<DB>;
    boss?: PgBossSender;
  }
}

export function buildApp(config: ApiConfig, opts: { boss?: PgBossSender } = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      base: { service: 'api' },
    },
    genReqId: () => randomUUID(),
  });

  const db = createDb(config.DATABASE_URL);
  app.decorate('db', db);
  if (opts.boss) {
    app.decorate('boss', opts.boss);
  }

  app.register(cors, { origin: true });
  app.register(registerSecurity);
  registerCache(app, config.REDIS_URL);
  registerMetrics(app);

  app.register(searchRoutes, { prefix: '/api/v1' });
  app.register(productRoutes, { prefix: '/api/v1' });
  app.register(taxonomyRoutes, { prefix: '/api/v1' });
  app.register(historyRoutes, { prefix: '/api/v1' });
  app.register(dealsRoutes, { prefix: '/api/v1' });
  app.register(adminDealRoutes, { prefix: '/api/v1' });
  app.register(adminIngestRoutes, { prefix: '/api/v1' });
  app.register(adminMatchRoutes, { prefix: '/api/v1' });

  app.get('/healthz', async () => {
    await db.selectFrom('store').select('id').limit(1).execute();
    return { status: 'ok', version: '0.1.0' };
  });

  app.setErrorHandler((err: unknown, request, reply) => {
    if (err instanceof AppError) {
      reply.status(err.httpStatus).send({
        error: { code: err.code, message: err.message },
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const statusCode =
      err instanceof Error ? (err as { statusCode?: number }).statusCode : undefined;
    if (typeof statusCode === 'number') {
      reply.status(statusCode).send({
        error: { code: 'invalid_query', message },
      });
      return;
    }
    request.log.error(
      { err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) },
      'internal_error',
    );
    reply.status(500).send({
      error: { code: 'internal_error', message: 'Error interno', correlationId: request.id },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: 'Ruta inexistente' } });
  });

  app.addHook('onClose', async () => {
    await db.destroy();
  });

  return app;
}
