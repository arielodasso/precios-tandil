import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  await app.register(rateLimit, {
    global: true,
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'rate_limited', message: 'Demasiadas solicitudes, intentá más tarde' },
    }),
  });
}
