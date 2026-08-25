import { sql } from 'kysely';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AppError } from '@precios/shared';
import { requireAdmin } from '../../plugins/auth.ts';

interface CandidateRow {
  candidate_id: number;
  product_slug: string;
  product_name: string;
  detected_at: Date;
  discount_pct: string | number;
  evidence: unknown;
  status: string;
  badge: string | null;
}

/**
 * T059 — Endpoints admin de ofertas:
 *  - GET /admin/deals/candidates → pendientes (+publicadas para auditoría)
 *  - POST /admin/deals/candidates/:id/publish → crea deal_publication auditada
 *    con badge y expiración sugerida (30 días si no se envía expires_at);
 *  - POST /admin/deals/candidates/:id/reject → status='rejected' y
 *    rejected_until = now + 14 días (no re-proponer en ese plazo).
 */
export async function adminDealRoutes(app: FastifyInstance): Promise<void> {
  const auth = requireAdmin(app.db);

  app.get('/admin/deals/candidates', { preHandler: auth }, async () => {
    const rows = await sql<CandidateRow>`
        select dc.id as candidate_id,
               p.slug as product_slug,
               p.canonical_name as product_name,
               dc.detected_at,
               dc.discount_pct,
               dc.evidence,
               dc.status,
               dp.badge
        from deal_candidate dc
        join product p on p.id = dc.product_id
        left join deal_publication dp on dp.candidate_id = dc.id
        where dc.status in ('pending', 'published')
        order by case when dc.status = 'pending' then 0 else 1 end, dc.discount_pct desc
        limit 100
      `.execute(app.db);

    return {
      candidates: rows.rows.map((r) => ({
        id: Number(r.candidate_id),
        product_slug: r.product_slug,
        product_name: r.product_name,
        detected_at: new Date(r.detected_at).toISOString(),
        discount_pct: Number(r.discount_pct),
        evidence: r.evidence,
        status: r.status,
        badge: r.badge ?? null,
      })),
    };
  });

  app.post<{ Params: { id: string }; Body: { badge?: string; expires_at?: string } }>(
    '/admin/deals/candidates/:id/publish',
    { preHandler: auth },
    async (request, reply: FastifyReply) => {
      const id = Number.parseInt(request.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('invalid_query', 'id inválido');
      }

      const published = await app.db.transaction().execute(async (trx) => {
        const updated = await sql<{ id: number; product_id: string; status: string }>`
          update deal_candidate
          set status = 'published'
          where id = ${id} and status = 'pending'
          returning id::int, product_id, status
        `.execute(trx);
        const row = updated.rows[0];
        if (!row) {
          throw new AppError('not_found', `Candidato ${id} no existe o no está pendiente`);
        }

        const badge = request.body?.badge === 'gold' ? 'gold' : 'green';
        const expiresAt = request.body?.expires_at
          ? new Date(request.body.expires_at)
          : new Date(Date.now() + 30 * 86_400_000);
        if (Number.isNaN(expiresAt.getTime())) {
          throw new AppError('invalid_query', 'expires_at inválido');
        }

        await sql`
          insert into deal_publication (candidate_id, published_by, published_at, badge, expires_at)
          values (${id}, ${request.admin?.label ?? 'desconocido'}, now(), ${badge}, ${expiresAt})
        `.execute(trx);

        return row.id;
      });

      void published;
      return reply.code(200).send({ ok: true });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/deals/candidates/:id/reject',
    { preHandler: auth },
    async (request, reply: FastifyReply) => {
      const id = Number.parseInt(request.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('invalid_query', 'id inválido');
      }
      const rejectedUntil = new Date(Date.now() + 14 * 86_400_000);
      const result = await sql<{ id: number }>`
        update deal_candidate
        set status = 'rejected',
            rejected_until = ${rejectedUntil}
        where id = ${id} and status in ('pending', 'published')
        returning id::int
      `.execute(app.db);
      if (!result.rows[0]) {
        throw new AppError('not_found', `Candidato ${id} no existe o ya fue cerrado`);
      }
      return reply.code(200).send({ ok: true, rejected_until: rejectedUntil.toISOString() });
    },
  );
}
