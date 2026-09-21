import { sql, type Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import { loadOffersByProduct } from './offers';
import type { CardOffer, ProductUnit } from '@/lib/types';
import { stripAccents } from '@/lib/utils';
import type { SortOption } from '@/components/SortBar';

export const SEARCH_PAGE_SIZE = 12;
const FRESH_WINDOW_DAYS = 7;
const freshWindowInterval = sql.raw(`interval '${FRESH_WINDOW_DAYS} days'`);

export interface SearchResultItem {
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  unit: ProductUnit | null;
  best_price: number | null;
  stores_count: number | null;
  image_url: string | null;
  offers: CardOffer[];
}

export interface SearchResults {
  items: SearchResultItem[];
  total: number;
  totalPages: number;
}

export interface SearchApiParams {
  q: string;
  limit: number;
  offset: number;
  category: string | null;
  stores: string[];
}

export async function resolveCategoryPath(db: Kysely<DB>, token: string): Promise<string | null> {
  const rows = await sql<{ path: string }>`
    select path from category
    where slug = ${token} or path = ${token}
    order by case when path = ${token} then 0 else 1 end
    limit 1
  `.execute(db);
  return rows.rows[0]?.path ?? null;
}

export interface SearchApiRow {
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  best_price: number | null;
  stores_count: number | null;
  freshest_captured_at: string | null;
}

export async function searchApiRows(
  db: Kysely<DB>,
  params: SearchApiParams,
): Promise<SearchApiRow[]> {
  const { q, limit, offset, category, stores } = params;
  const tsQuery = sql`websearch_to_tsquery('spanish', unaccent(${q}))`;
  const storeFilter = stores.length > 0 ? sql`s.slug in (${sql.join(stores, sql`, `)})` : sql`true`;
  const categoryFilter =
    category !== null ? sql`and (c.path = ${category} or c.path like ${`${category}/%`})` : sql``;
  const ilikeClause = sql`or unaccent(coalesce(p.canonical_name, '')) ilike ${`%${stripAccents(q)}%`} or unaccent(coalesce(p.brand, '')) ilike ${`%${stripAccents(q)}%`}`;

  const result = await sql<{
    slug: string;
    name: string;
    brand: string | null;
    category: string | null;
    image_url: string | null;
    best_price: number | null;
    stores_count: number | null;
    freshest_captured_at: Date | string | null;
  }>`
    with avail as (
      select distinct ml.product_id
      from price_record pr
      join store_sku ss on ss.id = pr.store_sku_id
      join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto', 'confirmed')
      join store s on s.id = ss.store_id
      where pr.is_suspect = false
        and pr.captured_at >= now() - ${freshWindowInterval}
        and ${storeFilter}
    )
    select p.slug,
           p.canonical_name as name,
           p.brand,
           c.path as category,
           p.image_url,
           pa.best_price::float8 as best_price,
           pa.stores_count,
           pa.best_captured_at as freshest_captured_at
    from product p
    join price_aggregate pa on pa.product_id = p.id
    left join category c on c.id = p.category_id
    where (p.search_vector @@ ${tsQuery} or p.canonical_name % unaccent(${q})
           ${ilikeClause})
      and exists (select 1 from avail a where a.product_id = p.id)
      and pa.stores_count >= 2
      and pa.best_price::numeric >= 500
      ${categoryFilter}
    order by greatest(
               ts_rank_cd(p.search_vector, ${tsQuery}),
               similarity(p.canonical_name, unaccent(${q}))
             ) desc,
             pa.best_price asc
    limit ${limit} offset ${offset}
  `.execute(db);

  return result.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    category: row.category,
    image_url: row.image_url,
    best_price:
      row.best_price === null || row.best_price === undefined
        ? null
        : Math.round(Number(row.best_price) * 100) / 100,
    stores_count:
      row.stores_count === null || row.stores_count === undefined ? null : Number(row.stores_count),
    freshest_captured_at:
      row.freshest_captured_at === null || row.freshest_captured_at === undefined
        ? null
        : new Date(row.freshest_captured_at).toISOString(),
  }));
}

export async function searchPublishedProducts(
  db: Kysely<DB>,
  q: string,
  page: number,
  sort: SortOption = 'relevance',
): Promise<SearchResults> {
  const items: SearchResultItem[] = [];
  let total = 0;
  let totalPages = 1;

  if (q.length >= 2 && q.length <= 64) {
    const normQ = stripAccents(q);
    const tsQuery = sql`websearch_to_tsquery('spanish', unaccent(${q}))`;
    const countRows = await sql<{ total: number }>`
      select count(*)::int as total
      from product p
      join price_aggregate pa on pa.product_id = p.id
      where (p.search_vector @@ ${tsQuery} or p.canonical_name % unaccent(${q})
             or unaccent(coalesce(p.canonical_name, '')) ilike ${`%${normQ}%`}
             or unaccent(coalesce(p.brand, '')) ilike ${`%${normQ}%`})
        and pa.stores_count >= 2 and pa.best_price::numeric >= 500
        and exists (
          select 1 from price_record pr
          join store_sku ss on ss.id = pr.store_sku_id
          join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto','confirmed')
          where pr.is_suspect = false
            and pr.captured_at >= now() - ${freshWindowInterval}
            and ml.product_id = p.id
        )
    `.execute(db);
    total = Number(countRows.rows[0]?.total ?? 0);
    totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));

    const offset = (page - 1) * SEARCH_PAGE_SIZE;
    const rows = await sql<{
      id: string | number;
      slug: string;
      name: string;
      brand: string | null;
      unit_amount: string | null;
      unit_type: string | null;
      best_price: number | null;
      stores_count: number | null;
      image_url: string | null;
    }>`
      select p.id,
             p.slug,
             p.canonical_name as name,
             p.brand,
             p.unit_amount,
             p.unit_type,
             pa.best_price::float8 as best_price,
             pa.stores_count,
             p.image_url
      from product p
      join price_aggregate pa on pa.product_id = p.id
      where (p.search_vector @@ ${tsQuery} or p.canonical_name % unaccent(${q})
             or unaccent(coalesce(p.canonical_name, '')) ilike ${`%${normQ}%`}
             or unaccent(coalesce(p.brand, '')) ilike ${`%${normQ}%`})
        and pa.stores_count >= 2 and pa.best_price::numeric >= 500
        and exists (
          select 1 from price_record pr
          join store_sku ss on ss.id = pr.store_sku_id
          join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto','confirmed')
          where pr.is_suspect = false
            and pr.captured_at >= now() - ${freshWindowInterval}
            and ml.product_id = p.id
        )
      order by
        ${
          sort === 'relevance'
            ? sql`greatest(ts_rank_cd(p.search_vector, ${tsQuery}), similarity(p.canonical_name, unaccent(${q}))) desc, pa.best_price asc nulls last`
            : sort === 'az'
              ? sql`p.canonical_name asc nulls last`
              : sort === 'za'
                ? sql`p.canonical_name desc nulls last`
                : sort === 'price_desc'
                  ? sql`pa.best_price desc nulls last, p.canonical_name asc`
                  : sql`pa.best_price asc nulls last, p.canonical_name asc`
        }
      limit ${SEARCH_PAGE_SIZE} offset ${offset}
    `.execute(db);

    const ids = rows.rows.map((r) => Number(r.id));
    const offersByProduct = await loadOffersByProduct(db, ids);

    for (const r of rows.rows) {
      const id = Number(r.id);
      items.push({
        id,
        slug: r.slug,
        name: r.name,
        brand: r.brand,
        unit:
          r.unit_amount != null && r.unit_type != null
            ? { amount: Number(r.unit_amount), type: r.unit_type as ProductUnit['type'] }
            : null,
        best_price: r.best_price === null ? null : Math.round(Number(r.best_price) * 100) / 100,
        stores_count: r.stores_count,
        image_url: r.image_url,
        offers: offersByProduct.get(id) ?? [],
      });
    }
  }

  return { items, total, totalPages };
}
