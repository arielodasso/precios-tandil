import { sql } from 'kysely';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AppError } from '@precios/shared';
import { requireAdmin } from '../../plugins/auth.ts';

interface RunRow {
  run_id: string;
  store_slug: string;
  store_name: string;
  started_at: Date;
  finished_at: Date | null;
  status: string;
  skus_captured: number;
  skus_rejected: number;
  http_errors: number;
  quarantined: boolean;
  correlation_id: string;
}

/**
 * T066 — Endpoints admin de ingesta:
 *  - GET /admin/ingest/runs → últimas corridas por tienda con métricas;
 *  - POST /admin/ingest/stores/:slug/retry → re-encola la tienda en la cola
 *    'ingest' de pg-boss (202 Accepted) o 409 run_in_progress si ya hay una
 *    corrida running para esa tienda.
 */
export async function adminIngestRoutes(app: FastifyInstance): Promise<void> {
  const auth = requireAdmin(app.db);

  app.get('/admin/ingest/runs', { preHandler: auth }, async () => {
    const rows = await sql<RunRow>`
      select rr.run_id,
             s.slug as store_slug,
             s.name as store_name,
             rr.started_at,
             rr.finished_at,
             rr.status,
             rr.skus_captured,
             rr.skus_rejected,
             rr.http_errors,
             rr.quarantined,
             rr.correlation_id
      from run_report rr
      join store s on s.id = rr.store_id
      order by rr.started_at desc
      limit 100
    `.execute(app.db);

    return {
      runs: rows.rows.map((r) => ({
        run_id: r.run_id,
        store_slug: r.store_slug,
        store_name: r.store_name,
        started_at: new Date(r.started_at).toISOString(),
        finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
        status: r.status,
        skus_captured: Number(r.skus_captured),
        skus_rejected: Number(r.skus_rejected),
        http_errors: Number(r.http_errors),
        quarantined: Boolean(r.quarantined),
        correlation_id: r.correlation_id,
      })),
    };
  });

  app.post<{ Params: { slug: string } }>(
    '/admin/ingest/stores/:slug/retry',
    { preHandler: auth },
    async (request, reply: FastifyReply) => {
      const slug = request.params.slug;

      const storeRows = await sql<{ id: number; is_active: boolean }>`
        select id::int, is_active from store where slug = ${slug} limit 1
      `.execute(app.db);
      const store = storeRows.rows[0];
      if (!store) throw new AppError('not_found', `Tienda '${slug}' no encontrada`);
      if (!store.is_active) {
        throw new AppError('invalid_query', `Tienda '${slug}' está desactivada`);
      }

      const running = await sql<{ run_id: string }>`
        select run_id from run_report
        where store_id = ${store.id} and status = 'running'
          and started_at > now() - interval '4 hours'
        limit 1
      `.execute(app.db);
      if (running.rows.length > 0) {
        throw new AppError('run_in_progress', 'Ya existe una corrida en curso para esta tienda');
      }

      const boss = app.boss;
      if (!boss) {
        throw new AppError('internal_error', 'Cola pg-boss no configurada en este proceso');
      }
      await boss.send('ingest', { slug });

      return reply.code(202).send({ ok: true, queued: true });
    },
  );
}
