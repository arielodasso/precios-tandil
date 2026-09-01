import { sql, type Kysely } from 'kysely';
import type { DB } from '@precios/shared';

/**
 * Analytics panel queries for Tandil Alerta.
 * All queries use only auto/confirmed match_links and fresh price records.
 */

export type KyselyDB = Kysely<DB>;

/** General overview stats */
export async function getOverview(db: KyselyDB) {
  const [products, stores, prices, deals] = await Promise.all([
    db
      .selectFrom('product')
      .select((eb) => eb.fn.count('id').as('count'))
      .executeTakeFirst(),
    db
      .selectFrom('store')
      .where('is_active', '=', true)
      .select((eb) => eb.fn.count('id').as('count'))
      .executeTakeFirst(),
    db
      .selectFrom('price_record as pr')
      .innerJoin('store_sku as ss', 'ss.id', 'pr.store_sku_id')
      .innerJoin('match_link as ml', 'ml.store_sku_id', 'ss.id')
      .where('ml.status', 'in', ['auto', 'confirmed'])
      .where('pr.is_suspect', '=', false)
      .where('pr.captured_at', '>=', sql<Date>`now() - interval '24 hours'`)
      .select((eb) => eb.fn.count('pr.id').as('count'))
      .executeTakeFirst(),
    db
      .selectFrom('deal_candidate as dc')
      .innerJoin('deal_publication as dp', 'dp.candidate_id', 'dc.id')
      .where('dc.status', '=', 'published')
      .where('dp.expires_at', '>', sql<Date>`now()`)
      .select((eb) => eb.fn.count('dc.id').as('count'))
      .executeTakeFirst(),
  ]);

  return {
    total_products: Number(products?.count ?? 0),
    active_stores: Number(stores?.count ?? 0),
    prices_today: Number(prices?.count ?? 0),
    active_deals: Number(deals?.count ?? 0),
  };
}

/** Products with biggest price drops in 7 days */
export async function getBiggestDrops(db: KyselyDB, limit = 10) {
  return db
    .selectFrom('price_aggregate as pa')
    .innerJoin('product as p', 'p.id', 'pa.product_id')
    .innerJoin('store as s', 's.id', 'pa.best_store_id')
    .where('pa.stores_count', '>=', 2)
    .where('pa.pct_change_7d', 'is not', null)
    .where('pa.pct_change_7d', '<', sql.lit('0'))
    .where('pa.best_price', 'is not', null)
    .select([
      'p.slug',
      'p.canonical_name as name',
      'p.brand',
      'pa.best_price',
      'pa.pct_change_7d',
      'pa.stores_count',
      's.name as best_store',
      's.slug as best_store_slug',
      'pa.avg_30d',
    ])
    .orderBy('pa.pct_change_7d', 'asc')
    .limit(limit)
    .execute();
}

/** Products with biggest price increases in 7 days */
export async function getBiggestRises(db: KyselyDB, limit = 10) {
  return db
    .selectFrom('price_aggregate as pa')
    .innerJoin('product as p', 'p.id', 'pa.product_id')
    .innerJoin('store as s', 's.id', 'pa.best_store_id')
    .where('pa.stores_count', '>=', 2)
    .where('pa.pct_change_7d', 'is not', null)
    .where('pa.pct_change_7d', '>', sql.lit('0'))
    .where('pa.best_price', 'is not', null)
    .select([
      'p.slug',
      'p.canonical_name as name',
      'p.brand',
      'pa.best_price',
      'pa.pct_change_7d',
      'pa.stores_count',
      's.name as best_store',
      's.slug as best_store_slug',
      'pa.avg_30d',
    ])
    .orderBy('pa.pct_change_7d', 'desc')
    .limit(limit)
    .execute();
}

/** Products with biggest price spread across stores */
export async function getPriceGaps(db: KyselyDB, limit = 10) {
  return db
    .selectFrom('price_aggregate as pa')
    .innerJoin('product as p', 'p.id', 'pa.product_id')
    .innerJoin('store as s', 's.id', 'pa.best_store_id')
    .where('pa.stores_count', '>=', 2)
    .where('pa.best_price', 'is not', null)
    .where('pa.avg_30d', '>', sql.lit('0'))
    .select([
      'p.slug',
      'p.canonical_name as name',
      'p.brand',
      'pa.best_price',
      'pa.avg_30d',
      'pa.stores_count',
      's.name as best_store',
      's.slug as best_store_slug',
      sql<number>`round(((pa.avg_30d::numeric - pa.best_price::numeric) / pa.avg_30d::numeric * 100), 1)`.as(
        'savings_pct',
      ),
    ])
    .orderBy(sql`(pa.avg_30d::numeric - pa.best_price::numeric)`, 'desc')
    .limit(limit)
    .execute();
}

/**
 * Canasta comparable: solo se incluyen productos que tienen precio fresco en
 * TODAS las tiendas activas, por lo que cada tienda valúa exactamente la misma
 * canasta (misma cantidad de productos) con su propio precio. Si una tienda no
 * vende alguno de los productos, ese producto queda fuera de la comparación.
 */
export async function getBasketByStore(db: KyselyDB) {
  const rows = await sql<{
    store_slug: string;
    store_name: string;
    products_count: number;
    avg_price: string;
    total_basket: string;
  }>`
    with prices as (
      select ml.product_id, ss.store_id, min(pr.price_amount) as price
      from match_link ml
      join store_sku ss on ss.id = ml.store_sku_id and ss.is_active
      join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
        and pr.captured_at >= now() - interval '7 days'
      where ml.status in ('auto', 'confirmed')
      group by ml.product_id, ss.store_id
    ),
    presence as (
      select product_id, count(distinct store_id) as n
      from prices group by product_id
    ),
    active_stores as (
      select count(*) as n from store where is_active
    ),
    comparable as (
      select p.product_id
      from presence p join active_stores a on p.n = a.n
    ),
    per_store as (
      select pric.store_id,
             count(*)::int as products_count,
             avg(pric.price) as avg_price,
             sum(pric.price) as total
      from prices pric
      join comparable comp on comp.product_id = pric.product_id
      group by pric.store_id
    )
    select
      s.slug as store_slug,
      s.name as store_name,
      per_store.products_count as products_count,
      round(per_store.avg_price::numeric, 0)::text as avg_price,
      round(per_store.total::numeric, 0)::text as total_basket
    from per_store
    join store s on s.id = per_store.store_id
    order by per_store.total asc
  `
    .execute(db)
    .then((r) => r.rows);

  return rows.map((r) => ({
    store_slug: r.store_slug,
    store_name: r.store_name,
    products_count: Number(r.products_count),
    avg_price: r.avg_price,
    total_basket: r.total_basket,
  }));
}

/** Per-store competitiveness: how often each store has the best price */
export async function getStoreCompetitiveness(db: KyselyDB) {
  return db
    .selectFrom('price_aggregate as pa')
    .innerJoin('store as s', 's.id', 'pa.best_store_id')
    .select([
      's.slug as store_slug',
      's.name as store_name',
      sql<number>`count(*)::int`.as('best_price_count'),
    ])
    .where('pa.best_price', 'is not', null)
    .where('pa.stores_count', '>=', 2)
    .groupBy(['s.slug', 's.name'])
    .orderBy(sql`count(*)`, 'desc')
    .execute();
}

/** Products near historical minimum (best_price <= min_90d * 1.05) */
export async function getNearHistoricalLow(db: KyselyDB, limit = 10) {
  return sql<{
    slug: string;
    name: string;
    brand: string | null;
    best_price: string;
    min_90d: string;
    stores_count: number;
    best_store: string;
    best_store_slug: string;
  }>`
    select
      p.slug,
      p.canonical_name as name,
      p.brand,
      pa.best_price,
      pa.min_90d,
      pa.stores_count,
      s.name as best_store,
      s.slug as best_store_slug
    from price_aggregate pa
    join product p on p.id = pa.product_id
    join store s on s.id = pa.best_store_id
    where pa.best_price is not null
      and pa.min_90d is not null
      and pa.stores_count >= 2
      and pa.best_price::numeric <= pa.min_90d::numeric * 1.05
    order by pa.best_price::numeric asc
    limit ${limit}
  `
    .execute(db)
    .then((r) => r.rows);
}
