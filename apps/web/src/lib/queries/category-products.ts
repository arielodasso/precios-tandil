import { sql, type Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import { loadOffersByProduct } from './offers';
import type { CardOffer } from '@/lib/types';

const DEFAULT_PAGE_SIZE = 10;

export interface CategorySummary {
  total_products: number;
  multi_store: number;
  avg_best_price: number | null;
  cheapest: { slug: string; name: string; brand: string | null; best_price: number } | null;
  best_savings: {
    slug: string;
    name: string;
    brand: string | null;
    best_price: number;
    avg_30d: number;
    savings_pct: number;
  } | null;
}

/** Resumen analítico de una categoría (misma lógica de path que el listado). */
export async function getCategorySummary(
  db: Kysely<DB>,
  categoryToken: string,
): Promise<CategorySummary | null> {
  const cat = await sql<{ path: string }>`
    select path from category
    where slug = ${categoryToken} or path = ${categoryToken}
    order by case when path = ${categoryToken} then 0 else 1 end
    limit 1
  `.execute(db);
  const categoryPath = cat.rows[0]?.path ?? null;
  if (!categoryPath) return null;
  const pathFilter = sql`(c.path = ${categoryPath} or c.path like ${`${categoryPath}/%`})`;

  const agg = await sql<{
    total_products: string;
    multi_store: string;
    avg_best_price: string;
  }>`
    select
      count(*)::int as total_products,
      count(*) filter (where pa.stores_count >= 2)::int as multi_store,
      round(avg(pa.best_price)::numeric, 0)::text as avg_best_price
    from product p
    join category c on c.id = p.category_id
    join price_aggregate pa on pa.product_id = p.id
    where ${pathFilter}
  `.execute(db);

  const cheapest = await sql<{
    slug: string;
    name: string;
    brand: string | null;
    best_price: string;
  }>`
    select p.slug, p.canonical_name as name, p.brand, pa.best_price::float8 as best_price
    from product p
    join category c on c.id = p.category_id
    join price_aggregate pa on pa.product_id = p.id
    where ${pathFilter} and pa.best_price is not null
    order by pa.best_price asc
    limit 1
  `.execute(db);

  const bestSavings = await sql<{
    slug: string;
    name: string;
    brand: string | null;
    best_price: string;
    avg_30d: string;
    savings_pct: string;
  }>`
    select p.slug, p.canonical_name as name, p.brand,
           pa.best_price::float8 as best_price, pa.avg_30d::float8 as avg_30d,
           round(((pa.avg_30d::numeric - pa.best_price::numeric) / pa.avg_30d::numeric * 100), 1)::text as savings_pct
    from product p
    join category c on c.id = p.category_id
    join price_aggregate pa on pa.product_id = p.id
    where ${pathFilter} and pa.stores_count >= 2
      and pa.best_price is not null and pa.avg_30d is not null and pa.avg_30d > 0
    order by (pa.avg_30d::numeric - pa.best_price::numeric) desc
    limit 1
  `.execute(db);

  return {
    total_products: Number(agg.rows[0]?.total_products ?? 0),
    multi_store: Number(agg.rows[0]?.multi_store ?? 0),
    avg_best_price: agg.rows[0]?.avg_best_price == null ? null : Number(agg.rows[0].avg_best_price),
    cheapest: cheapest.rows[0]
      ? {
          slug: cheapest.rows[0].slug,
          name: cheapest.rows[0].name,
          brand: cheapest.rows[0].brand,
          best_price: Number(cheapest.rows[0].best_price),
        }
      : null,
    best_savings: bestSavings.rows[0]
      ? {
          slug: bestSavings.rows[0].slug,
          name: bestSavings.rows[0].name,
          brand: bestSavings.rows[0].brand,
          best_price: Number(bestSavings.rows[0].best_price),
          avg_30d: Number(bestSavings.rows[0].avg_30d),
          savings_pct: Number(bestSavings.rows[0].savings_pct),
        }
      : null,
  };
}

interface CategoryProductRow {
  id: string | number;
  slug: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  best_price: string | number | null;
  stores_count: string | number | null;
}

export interface CategoryProductItem {
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  best_price: number | null;
  stores_count: number | null;
  offers: CardOffer[];
}

export interface CategoryProductPage {
  items: CategoryProductItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface CategoryProductCountRow {
  total: string | number;
}

/**
 * Lista los productos que pertenecen a una categoría (incluyendo
 * subcategorías). La pertenencia queda garantizada por el path de la
 * categoría. Devuelve además el total para paginar. Si la categoría no
 * existe devuelve null.
 */
export async function listCategoryProducts(
  db: Kysely<DB>,
  categoryToken: string,
  opts: { page?: number; pageSize?: number; q?: string } = {},
): Promise<CategoryProductPage | null> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? DEFAULT_PAGE_SIZE, 1), 60);
  const offset = (page - 1) * pageSize;
  const q = opts.q?.trim() ?? '';

  const cat = await sql<{ path: string }>`
    select path from category
    where slug = ${categoryToken} or path = ${categoryToken}
    order by case when path = ${categoryToken} then 0 else 1 end
    limit 1
  `.execute(db);

  const categoryPath = cat.rows[0]?.path ?? null;
  if (!categoryPath) return null;

  const searchClause =
    q.length > 0
      ? sql`and (p.canonical_name ilike ${`%${q}%`} or p.brand ilike ${`%${q}%`})`
      : sql``;

  const countRows = await sql<CategoryProductCountRow>`
    select count(*)::int as total
    from product p
    join category c on c.id = p.category_id
    join price_aggregate pa on pa.product_id = p.id
    where (c.path = ${categoryPath} or c.path like ${`${categoryPath}/%`})
      ${searchClause}
  `.execute(db);
  const total = Number(countRows.rows[0]?.total ?? 0);

  const rows = await sql<CategoryProductRow>`
    select p.id, p.slug, p.canonical_name as name, p.brand, p.image_url,
           pa.best_price::float8 as best_price, pa.stores_count
    from product p
    join category c on c.id = p.category_id
    join price_aggregate pa on pa.product_id = p.id
    where (c.path = ${categoryPath} or c.path like ${`${categoryPath}/%`})
      ${searchClause}
    order by pa.best_price asc nulls last, p.canonical_name asc
    limit ${pageSize} offset ${offset}
  `.execute(db);

  const ids = rows.rows.map((r) => Number(r.id));
  const offersByProduct = await loadOffersByProduct(db, ids);

  const items: CategoryProductItem[] = rows.rows.map((r) => {
    const id = Number(r.id);
    return {
      id,
      slug: r.slug,
      name: r.name,
      brand: r.brand,
      image_url: r.image_url,
      best_price: r.best_price == null ? null : Number(r.best_price),
      stores_count: r.stores_count == null ? null : Number(r.stores_count),
      offers: offersByProduct.get(id) ?? [],
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { items, total, page, pageSize, totalPages };
}
