import { sql, type Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import { loadOffersByProduct } from './offers';
import type { CardOffer } from '@/lib/types';

interface DealRow {
  product_id: string | number;
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
  offers: CardOffer[];
}

export async function listPublishedDeals(db: Kysely<DB>): Promise<DealPublicItem[]> {
  const rows = await sql<DealRow>`
    select distinct on (p.id)
           p.id as product_id, p.slug as product_slug, p.canonical_name as product_name,
           p.image_url,
           pa.best_store_id, pa.best_price, dc.discount_pct,
           case when dp.badge is not null then dp.badge
                else case when dc.discount_pct >= 25 then 'gold' else 'green' end
           end as badge,
           coalesce(dp.published_at, dc.detected_at) as published_at,
           dp.expires_at, s.slug as best_store_slug
    from deal_candidate dc
    join product p on p.id = dc.product_id
    left join deal_publication dp on dp.candidate_id = dc.id
    left join price_aggregate pa on pa.product_id = p.id
    left join store s on s.id = pa.best_store_id
    where dc.status in ('pending', 'published')
      and (dp.expires_at is null or dp.expires_at > now())
    order by p.id, dc.discount_pct desc, dc.detected_at desc
    limit 50
  `.execute(db);

  const offersByProduct = await loadOffersByProduct(
    db,
    rows.rows.map((r) => Number(r.product_id)),
  );

  return rows.rows.map((r) => {
    const pid = Number(r.product_id);
    return {
      slug: r.product_slug,
      name: r.product_name,
      image_url: r.image_url ?? null,
      store_slug: r.best_store_slug ?? null,
      price: r.best_price == null ? null : Number(r.best_price),
      discount_pct: Number(r.discount_pct),
      badge: r.badge,
      published_at: new Date(r.published_at).toISOString(),
      expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      offers: offersByProduct.get(pid) ?? [],
    };
  });
}
