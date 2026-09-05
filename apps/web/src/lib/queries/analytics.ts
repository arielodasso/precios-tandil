import { sql, type Kysely, type SqlBool } from 'kysely';
import type { DB } from '@precios/shared';
import type { CbaResolvedProduct } from '@/lib/cba';

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
      .where(sql<SqlBool>`pr.price_amount::numeric >= 500`)
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

/** Products with biggest price drops in 7 days (falls back to avg_30d when no 7d history) */
export async function getBiggestDrops(db: KyselyDB, limit = 10) {
  return db
    .selectFrom('price_aggregate as pa')
    .innerJoin('product as p', 'p.id', 'pa.product_id')
    .innerJoin('store as s', 's.id', 'pa.best_store_id')
    .where('pa.stores_count', '>=', 2)
    .where('pa.best_price', 'is not', null)
    .where(sql<SqlBool>`pa.best_price::numeric >= 500`)
    .where((eb) =>
      eb.or([
        eb('pa.pct_change_7d', '<', '0'),
        eb.and([
          eb('pa.pct_change_7d', 'is', null),
          eb('pa.avg_30d', '>', '0'),
          eb('pa.best_price', '<', eb.ref('pa.avg_30d')),
        ]),
      ]),
    )
    .select([
      'p.slug',
      'p.canonical_name as name',
      'p.brand',
      'pa.best_price',
      'pa.avg_30d',
      'pa.stores_count',
      's.name as best_store',
      's.slug as best_store_slug',
      sql<number>`coalesce(
        pa.pct_change_7d,
        round(((pa.best_price::numeric - pa.avg_30d::numeric) / pa.avg_30d::numeric * 100)::numeric, 2)
      )`.as('pct_change_7d'),
    ])
    .orderBy(
      sql`coalesce(
        pa.pct_change_7d,
        (pa.best_price::numeric - pa.avg_30d::numeric) / pa.avg_30d::numeric * 100
      )`,
      'asc',
    )
    .limit(limit)
    .execute();
}

/** Products with biggest price increases in 7 days (falls back to avg_30d when no 7d history) */
export async function getBiggestRises(db: KyselyDB, limit = 10) {
  return db
    .selectFrom('price_aggregate as pa')
    .innerJoin('product as p', 'p.id', 'pa.product_id')
    .innerJoin('store as s', 's.id', 'pa.best_store_id')
    .where('pa.stores_count', '>=', 2)
    .where('pa.best_price', 'is not', null)
    .where(sql<SqlBool>`pa.best_price::numeric >= 500`)
    .where((eb) =>
      eb.or([
        eb('pa.pct_change_7d', '>', '0'),
        eb.and([
          eb('pa.pct_change_7d', 'is', null),
          eb('pa.avg_30d', '>', '0'),
          eb('pa.best_price', '>', eb.ref('pa.avg_30d')),
        ]),
      ]),
    )
    .select([
      'p.slug',
      'p.canonical_name as name',
      'p.brand',
      'pa.best_price',
      'pa.avg_30d',
      'pa.stores_count',
      's.name as best_store',
      's.slug as best_store_slug',
      sql<number>`coalesce(
        pa.pct_change_7d,
        round(((pa.best_price::numeric - pa.avg_30d::numeric) / pa.avg_30d::numeric * 100)::numeric, 2)
      )`.as('pct_change_7d'),
    ])
    .orderBy(
      sql`coalesce(
        pa.pct_change_7d,
        (pa.best_price::numeric - pa.avg_30d::numeric) / pa.avg_30d::numeric * 100
      )`,
      'desc',
    )
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
    .where(sql<SqlBool>`pa.best_price::numeric >= 500`)
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
 * Canasta por tienda (metodología "precio medio del producto"):
 * Se define un conjunto común de productos comparables (presentes en 2+ tiendas
 * con precio fresco en 7 días). Para cada producto se calcula el precio de
 * referencia = promedio de los precios de las tiendas que lo venden.
 * Cada tienda valúa exactamente la MISMA canasta con su propio precio; si la
 * tienda no vende un producto, se le asigna el precio de referencia. Así todos
 * los conteos coinciden y se puede comparar verdaderamente quién es más barato.
 */
export async function getBasketByStore(db: KyselyDB) {
  const rows = await sql<{
    store_slug: string;
    store_name: string;
    products_count: number;
    products_present: number;
    total_basket: string;
    reference_total: string;
    vs_reference_pct: string;
  }>`
    with prices as (
      select ml.product_id, ss.store_id, min(pr.price_amount) as price
      from match_link ml
      join store_sku ss on ss.id = ml.store_sku_id and ss.is_active
      join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
        and pr.price_amount::numeric >= 500
        and pr.captured_at >= now() - interval '7 days'
      where ml.status in ('auto', 'confirmed')
      group by ml.product_id, ss.store_id
    ),
    presence as (
      select product_id, count(distinct store_id) as n
      from prices group by product_id
    ),
    comparable as (
      select product_id from presence where n >= 2
    ),
    prod_ref as (
      select pric.product_id, avg(pric.price) as ref_price
      from prices pric
      join comparable c on c.product_id = pric.product_id
      group by pric.product_id
    ),
    all_prices as (
      select pric.store_id, pric.product_id, pric.price
      from prices pric
      join comparable c on c.product_id = pric.product_id
    ),
    set_size as (
      select count(*)::int as n from comparable
    ),
    per_store as (
      select
        s.id as store_id,
        s.slug as store_slug,
        s.name as store_name,
        ss2.n as products_count,
        count(distinct ap.product_id)::int as products_present,
        round(sum(coalesce(ap.price, pr.ref_price))::numeric, 0) as total_basket,
        round(sum(pr.ref_price)::numeric, 0) as reference_total
      from comparable c
      cross join store s
      cross join set_size ss2
      join prod_ref pr on pr.product_id = c.product_id
      left join all_prices ap on ap.product_id = c.product_id and ap.store_id = s.id
      where s.is_active
      group by s.id, s.slug, s.name, ss2.n
    )
    select
      store_slug, store_name, products_count, products_present,
      total_basket::text as total_basket,
      reference_total::text as reference_total,
      round(((total_basket::numeric - reference_total::numeric) / nullif(reference_total::numeric, 0) * 100), 1)::text as vs_reference_pct
    from per_store
    where products_present >= 1
    order by total_basket asc
  `
    .execute(db)
    .then((r) => r.rows);

  return rows.map((r) => ({
    store_slug: r.store_slug,
    store_name: r.store_name,
    products_count: Number(r.products_count),
    products_present: Number(r.products_present),
    total_basket: r.total_basket,
    reference_total: r.reference_total,
    vs_reference_pct: r.vs_reference_pct,
  }));
}

/**
 * Canasta fija por tienda:
 * Igual metodología de valuación que getBasketByStore (mismo conjunto valuado,
 * con productos faltantes al precio de referencia) pero restringida al conjunto
 * FIJO de productos esenciales resuelto en lib/cba.
 */
export async function getCbaBasketByStore(db: KyselyDB, items: CbaResolvedProduct[]) {
  if (items.length === 0) return [];

  const payload = JSON.stringify(items.map((i) => ({ productId: i.productId })));

  const rows = await sql<{
    store_slug: string;
    store_name: string;
    products_count: number;
    products_present: number;
    total_basket: string;
    reference_total: string;
    vs_reference_pct: string;
  }>`
    with sel as (
      select (i.value->>'productId')::int as product_id
      from jsonb_array_elements(${payload}::jsonb) as i(value)
    ),
    prices as (
      select ml.product_id, ss.store_id, min(pr.price_amount::numeric) as price
      from match_link ml
      join store_sku ss on ss.id = ml.store_sku_id and ss.is_active
      join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
        and pr.price_amount::numeric >= 500
        and pr.captured_at >= now() - interval '7 days'
      where ml.status in ('auto', 'confirmed')
        and ml.product_id in (select product_id from sel)
      group by ml.product_id, ss.store_id
    ),
    prod_ref as (
      select product_id, avg(price) as ref_price
      from prices group by product_id
    ),
    basket_size as (
      select count(*)::int as n from prod_ref
    ),
    store_rows as (
      select distinct store_id from prices
    ),
    per_store as (
      select
        s.id as store_id,
        s.slug as store_slug,
        s.name as store_name,
        bs.n as products_count,
        count(distinct ap.product_id)::int as products_present,
        round(sum(coalesce(ap.price, pr.ref_price))::numeric, 0) as total_basket,
        round(sum(pr.ref_price)::numeric, 0) as reference_total
      from store_rows sr
      join store s on s.id = sr.store_id and s.is_active
      cross join basket_size bs
      join prod_ref pr on true
      left join prices ap on ap.store_id = sr.store_id and ap.product_id = pr.product_id
      group by s.id, s.slug, s.name, bs.n
    )
    select
      store_slug, store_name, products_count, products_present,
      total_basket::text as total_basket,
      reference_total::text as reference_total,
      round(((total_basket::numeric - reference_total::numeric) / nullif(reference_total::numeric, 0) * 100), 1)::text as vs_reference_pct
    from per_store
    where products_present >= 1
    order by total_basket asc
  `
    .execute(db)
    .then((r) => r.rows);

  return rows.map((r) => ({
    store_slug: r.store_slug,
    store_name: r.store_name,
    products_count: Number(r.products_count),
    products_present: Number(r.products_present),
    total_basket: r.total_basket,
    reference_total: r.reference_total,
    vs_reference_pct: r.vs_reference_pct,
  }));
}

export interface CbaStoreProduct {
  key: string;
  label: string;
  rubric: string;
  slug: string;
  name: string;
  brand: string | null;
  price: number | null;
  ref_price: number | null;
  is_missing: boolean;
}

export interface CbaStoreDetail {
  store_slug: string;
  store_name: string;
  products: CbaStoreProduct[];
}

/**
 * Detalle por tienda de la canasta fija: para cada tienda, todos los
 * productos de la canasta con su precio en esa tienda, el promedio de las
 * demás tiendas que lo venden y si está disponible o se valuó al promedio.
 */
export async function getCbaBasketDetail(db: KyselyDB, items: CbaResolvedProduct[]) {
  if (items.length === 0) return [];

  const payload = JSON.stringify(
    items.map((r) => ({ productId: r.productId, key: r.key, label: r.label, rubric: r.rubric })),
  );

  const rows = await sql<{
    store_slug: string;
    store_name: string;
    key: string;
    label: string;
    rubric: string;
    slug: string;
    name: string;
    brand: string | null;
    price: string | null;
    ref_price: string | null;
    is_missing: boolean;
  }>`
    with sel as (
      select (i.value->>'productId')::int as product_id,
             i.value->>'key' as key,
             i.value->>'label' as label,
             i.value->>'rubric' as rubric
      from jsonb_array_elements(${payload}::jsonb) as i(value)
    ),
    prices as (
      select ml.product_id, ss.store_id, min(pr.price_amount::numeric) as price
      from match_link ml
      join store_sku ss on ss.id = ml.store_sku_id and ss.is_active
      join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
        and pr.price_amount::numeric >= 500
        and pr.captured_at >= now() - interval '7 days'
      where ml.status in ('auto', 'confirmed')
        and ml.product_id in (select product_id from sel)
      group by ml.product_id, ss.store_id
    ),
    prod_ref as (
      select product_id, avg(price) as ref_price
      from prices group by product_id
    ),
    store_rows as (
      select distinct store_id from prices
    )
    select
      s.slug as store_slug,
      s.name as store_name,
      it.key, it.label, it.rubric,
      p.slug, p.canonical_name as name, p.brand,
      st.price::numeric::text as price,
      pr.ref_price::numeric::text as ref_price,
      (st.price is null) as is_missing
    from sel it
    join product p on p.id = it.product_id
    join prod_ref pr on pr.product_id = p.id
    cross join store_rows sr
    join store s on s.id = sr.store_id and s.is_active
    left join prices st on st.product_id = p.id and st.store_id = s.id
    order by s.id asc, it.rubric asc, it.label asc
  `
    .execute(db)
    .then((r) => r.rows);

  const byStore = new Map<string, CbaStoreDetail>();
  for (const r of rows) {
    let d = byStore.get(r.store_slug);
    if (!d) {
      d = { store_slug: r.store_slug, store_name: r.store_name, products: [] };
      byStore.set(r.store_slug, d);
    }
    d.products.push({
      key: r.key,
      label: r.label,
      rubric: r.rubric,
      slug: r.slug,
      name: r.name,
      brand: r.brand,
      price: r.price === null ? null : Number(r.price),
      ref_price: r.ref_price === null ? null : Number(r.ref_price),
      is_missing: r.is_missing,
    });
  }
  return [...byStore.values()];
}
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
    .where(sql<SqlBool>`pa.best_price::numeric >= 500`)
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
      and pa.best_price::numeric >= 500
      and pa.min_90d is not null
      and pa.stores_count >= 2
      and pa.best_price::numeric <= pa.min_90d::numeric * 1.05
    order by pa.best_price::numeric asc
    limit ${limit}
  `
    .execute(db)
    .then((r) => r.rows);
}

/** Products with most volatility: biggest absolute change vs avg_30d (both up and down) */
export async function getMostVolatile(db: KyselyDB, limit = 10) {
  return db
    .selectFrom('price_aggregate as pa')
    .innerJoin('product as p', 'p.id', 'pa.product_id')
    .innerJoin('store as s', 's.id', 'pa.best_store_id')
    .where('pa.stores_count', '>=', 2)
    .where('pa.best_price', 'is not', null)
    .where(sql<SqlBool>`pa.best_price::numeric >= 500`)
    .where('pa.avg_30d', '>', '0')
    .select([
      'p.slug',
      'p.canonical_name as name',
      'p.brand',
      'pa.best_price',
      'pa.avg_30d',
      'pa.stores_count',
      's.name as best_store',
      's.slug as best_store_slug',
      sql<number>`coalesce(
        pa.pct_change_7d,
        round(((pa.best_price::numeric - pa.avg_30d::numeric) / pa.avg_30d::numeric * 100)::numeric, 2)
      )`.as('pct_change_7d'),
      sql<number>`abs(coalesce(
        pa.pct_change_7d,
        (pa.best_price::numeric - pa.avg_30d::numeric) / pa.avg_30d::numeric * 100
      ))`.as('abs_change'),
    ])
    .orderBy('abs_change', 'desc')
    .limit(limit)
    .execute();
}

/** Top savings: biggest absolute $ difference between best_price and avg_30d */
export async function getTopSavings(db: KyselyDB, limit = 10) {
  return db
    .selectFrom('price_aggregate as pa')
    .innerJoin('product as p', 'p.id', 'pa.product_id')
    .innerJoin('store as s', 's.id', 'pa.best_store_id')
    .where('pa.stores_count', '>=', 2)
    .where('pa.best_price', 'is not', null)
    .where(sql<SqlBool>`pa.best_price::numeric >= 500`)
    .where('pa.avg_30d', '>', '0')
    .where('pa.best_price', '<', (eb) => eb.ref('pa.avg_30d'))
    .select([
      'p.slug',
      'p.canonical_name as name',
      'p.brand',
      'pa.best_price',
      'pa.avg_30d',
      'pa.stores_count',
      's.name as best_store',
      's.slug as best_store_slug',
      sql<number>`round((pa.avg_30d::numeric - pa.best_price::numeric), 2)`.as('savings_abs'),
      sql<number>`round(((pa.avg_30d::numeric - pa.best_price::numeric) / pa.avg_30d::numeric * 100), 1)`.as(
        'savings_pct',
      ),
    ])
    .orderBy(sql`(pa.avg_30d::numeric - pa.best_price::numeric)`, 'desc')
    .limit(limit)
    .execute();
}
