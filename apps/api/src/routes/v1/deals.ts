import { sql } from 'kysely';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import { AppError } from '@precios/shared';
import { cachedJson } from '../../plugins/cache.ts';

const DEALS_CACHE_TTL_SECONDS = 120;

interface DealRow {
  product_slug: string;
  product_name: string;
  image_url: string | null;
  best_store_slug: string | null;
  best_price: string | number | null;
  discount_pct: string | number;
  badge: string;
  published_at: Date;
  expires_at: Date | null;
}

export interface DealPublicItem {
  slug: string;
  name: string;
  image_url: string | null;
  store_slug: string | null;
  price: number | null;
  discount_pct: number;
  badge: string;
  published_at: string;
  expires_at: string | null;
}

/**
 * T060 — GET /api/v1/deals?status=published
 * Solo ofertas publicadas y vigentes (expires_at futuro o null).
 * status distinto de 'published' es inválido para el público general.
 */
export async function listPublishedDeals(db: Kysely<DB>): Promise<DealPublicItem[]> {
  const rows = await sql<DealRow>`
    select p.slug   as product_slug,
           p.canonical_name as product_name,
           p.image_url,
           pa.best_store_id,
           pa.best_price,
           dc.discount_pct,
           dp.badge,
           dp.published_at,
           dp.expires_at,
           s.slug as best_store_slug
    from deal_publication dp
    join deal_candidate dc on dc.id = dp.candidate_id and dc.status = 'published'
    join product p on p.id = dc.product_id
    left join price_aggregate pa on pa.product_id = p.id
    left join store s on s.id = pa.best_store_id
    where (dp.expires_at is null or dp.expires_at > now())
    order by dc.discount_pct desc, dp.published_at desc
    limit 50
  `.execute(db);

  return rows.rows.map((r) => ({
    slug: r.product_slug,
    name: r.product_name,
    image_url: r.image_url ?? null,
    store_slug: r.best_store_slug ?? null,
    price: r.best_price === null || r.best_price === undefined ? null : Number(r.best_price),
    discount_pct: Number(r.discount_pct),
    badge: r.badge,
    published_at: new Date(r.published_at).toISOString(),
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
  }));
}

export async function dealsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/deals', async (request: FastifyRequest) => {
    const status = (request.query as { status?: string }).status ?? 'published';
    if (status !== 'published') {
      throw new AppError(
        'invalid_query',
        "Solo se permite status='published' en el endpoint público",
      );
    }
    return cachedJson(app, request, 'deals', DEALS_CACHE_TTL_SECONDS, async () => ({
      deals: await listPublishedDeals(app.db),
    }));
  });
}
