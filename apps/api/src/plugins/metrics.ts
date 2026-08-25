import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import promClient from 'prom-client';

export const registry = new promClient.Registry();
registry.setDefaultLabels({ service: 'precios-api' });

const httpDuration = new promClient.Histogram({
  name: 'api_http_request_duration_seconds',
  help: 'Duración de requests HTTP (p95 en Prometheus)',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2],
});
registry.registerMetric(httpDuration);

/**
 * T070 — Métricas Prometheus: latencia HTTP por ruta/status, más métricas
 * default del proceso. El worker exporta sus contadores de captura
 * (skus_captured/rejected, tasa EAN, duración de corridas) vía logs
 * estructurados y el mismo formato de registro.
 */
export function registerMetrics(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    (request as unknown as { _metricsStart: bigint })._metricsStart = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const start = (request as unknown as { _metricsStart?: bigint })._metricsStart;
    if (start === undefined) return;
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    httpDuration
      .labels(request.method, request.routeOptions?.url ?? 'unmatched', String(reply.statusCode))
      .observe(seconds);
  });

  app.get('/metrics', async (_request, reply) => {
    void randomUUID; // sin correlación especial en /metrics
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}
