import { sql } from 'kysely';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AppError } from '@precios/shared';
import { requireAdmin } from '../../plugins/auth.ts';

interface PendingMatchRow {
  match_id: number;
  store_sku_id: number;
  product_slug: string;
  product_name: string;
  sku_name: string;
  sku_ean: string | null;
  method: string;
}

/**
 * T067 — Endpoints admin de matches:
 *  - GET /admin/matches/pending → match_link en estado pending (revisión manual);
 *  - POST /admin/matches/:id/decision { decision: 'confirmed'|'rejected' }
 *    audita quién decidió y cuándo.
 */
export async function adminMatchRoutes(app: FastifyInstance): Promise<void> {
  const auth = requireAdmin(app.db);

  app.get('/admin/matches/pending', { preHandler: auth }, async () => {
    const rows = await sql<PendingMatchRow>`
      select ml.id::int as match_id,
             ml.store_sku_id,
             p.slug as product_slug,
             p.canonical_name as product_name,
             ss.raw_description as sku_name,
             ss.declared_ean as sku_ean,
             ml.method
      from match_link ml
      join product p on p.id = ml.product_id
      join store_sku ss on ss.id = ml.store_sku_id
      where ml.status = 'pending_review'
      order by ml.method asc, p.slug asc
      limit 200
    `.execute(app.db);

    return {
      matches: rows.rows.map((r) => ({
        id: Number(r.match_id),
        store_sku_id: Number(r.store_sku_id),
        product_slug: r.product_slug,
        product_name: r.product_name,
        sku_name: r.sku_name,
        sku_ean: r.sku_ean ?? null,
        method: r.method,
      })),
    };
  });

  app.post<{ Params: { id: string }; Body: { decision?: string } }>(
    '/admin/matches/:id/decision',
    { preHandler: auth },
    async (request, reply: FastifyReply) => {
      const id = Number.parseInt(request.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('invalid_query', 'id inválido');
      }
      const decision = request.body?.decision;
      if (decision !== 'confirmed' && decision !== 'rejected') {
        throw new AppError('invalid_query', "decision debe ser 'confirmed' o 'rejected'");
      }

      const result = await sql<{ id: number }>`
        update match_link
        set status = ${decision},
            decided_by = ${request.admin?.label ?? 'desconocido'},
            decided_at = now()
        where id = ${id} and status = 'pending_review'
        returning id::int
      `.execute(app.db);

      if (!result.rows[0]) {
        throw new AppError('not_found', `Match ${id} no existe o ya fue decidido`);
      }
      return reply.code(200).send({ ok: true, decision });
    },
  );
}
