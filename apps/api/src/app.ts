import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import { AppError } from '@precios/shared';
import { createDb } from './lib/db.ts';
import type { ApiConfig } from './lib/config.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<DB>;
  }
}

export function buildApp(config: ApiConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      base: { service: 'api' },
    },
    genReqId: () => randomUUID(),
  });

  const db = createDb(config.DATABASE_URL);
  app.decorate('db', db);

  app.register(helmet);
  app.register(cors, { origin: true });
  app.register(rateLimit, { max: 60, timeWindow: '1 minute' });

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
