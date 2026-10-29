import { sql } from 'kysely';
import type { KyselyDB } from './analytics';

/**
 * Ofertas del día para el panel de Tandil Alerta.
 *
 * Usa las ofertas ya publicadas/detectadas por el pipeline (deal_candidate +
 * deal_publication) y las agrupa por rubro (primer nivel de la categoría).
 * Si todavía no hay publicaciones de las últimas 24 h, cae a las vigentes de
 * los últimos 7 días para que el bloque no quede vacío antes del sync diario.
 */

interface DailyOfferRaw {
  deal_id: number;
  slug: string;
  name: string;
  brand: string | null;
  rubro: string;
  discount_pct: string;
  best_price: string | null;
  avg_30d: string | null;
  store_name: string | null;
  store_slug: string | null;
  published_at: Date | string;
  expires_at: Date | string | null;
  badge: string | null;
}

export interface DailyOffer {
  deal_id: number;
  slug: string;
  name: string;
  brand: string | null;
  rubro: string;
  discount_pct: number;
  best_price: number | null;
  avg_30d: number | null;
  store_name: string | null;
  store_slug: string | null;
  published_at: string;
  expires_at: string | null;
  badge: string | null;
}

export interface DailyOfferGroup {
  rubro: string;
  offers: DailyOffer[];
}

export interface DailyOffersResult {
  offers: DailyOffer[];
  groups: DailyOfferGroup[];
  total: number;
  window_hours: number;
}

async function queryOffers(db: KyselyDB, hours: number, limit: number): Promise<DailyOfferRaw[]> {
  const result = await sql<DailyOfferRaw>`
    select dc.id as deal_id,
           p.slug,
           p.canonical_name as name,
           p.brand,
           coalesce(root.name, 'Otros') as rubro,
           dc.discount_pct,
           pa.best_price,
           pa.avg_30d,
           s.name as store_name,
           s.slug as store_slug,
           coalesce(dp.published_at, dc.detected_at) as published_at,
           dp.expires_at,
           dp.badge
    from deal_candidate dc
    inner join product p on p.id = dc.product_id
    left join category c on c.id = p.category_id
    left join category root on root.slug = split_part(c.path, '/', 1)
    inner join price_aggregate pa on pa.product_id = p.id
    left join store s on s.id = pa.best_store_id
    left join lateral (
      select publication.*
      from deal_publication publication
      where publication.candidate_id = dc.id
      order by publication.published_at desc
      limit 1
    ) dp on true
    where dc.status in ('published', 'pending')
      and (dp.expires_at is null or dp.expires_at > now())
      and coalesce(dp.published_at, dc.detected_at) >= now() - make_interval(hours => ${hours})
    order by dc.discount_pct::numeric desc, p.canonical_name asc
    limit ${limit}
  `.execute(db);

  return result.rows;
}

export async function getDailyOffers(db: KyselyDB, limit = 200): Promise<DailyOffersResult> {
  let windowHours = 24;
  let rows = await queryOffers(db, windowHours, limit);
  if (rows.length === 0) {
    windowHours = 24 * 7;
    rows = await queryOffers(db, windowHours, limit);
  }

  const offers: DailyOffer[] = rows.map((row) => ({
    deal_id: row.deal_id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    rubro: row.rubro,
    discount_pct: Number.parseFloat(row.discount_pct) || 0,
    best_price: row.best_price === null ? null : Number.parseFloat(row.best_price),
    avg_30d: row.avg_30d === null ? null : Number.parseFloat(row.avg_30d),
    store_name: row.store_name,
    store_slug: row.store_slug,
    published_at: toIso(row.published_at),
    expires_at: row.expires_at === null ? null : toIso(row.expires_at),
    badge: row.badge,
  }));

  const byRubro = new Map<string, DailyOffer[]>();
  for (const offer of offers) {
    const list = byRubro.get(offer.rubro) ?? [];
    list.push(offer);
    byRubro.set(offer.rubro, list);
  }

  const groups: DailyOfferGroup[] = [...byRubro.entries()]
    .map(([rubro, list]) => ({ rubro, offers: list }))
    .sort((a, b) => b.offers.length - a.offers.length || a.rubro.localeCompare(b.rubro, 'es'));

  return { offers, groups, total: offers.length, window_hours: windowHours };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
