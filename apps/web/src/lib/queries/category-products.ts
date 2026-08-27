import { sql, type Kysely } from 'kysely';
import type { DB } from '@precios/shared';

const FRESH_WINDOW_DAYS = 7;
const freshWindowInterval = sql.raw(`interval '${FRESH_WINDOW_DAYS} days'`);
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

interface CategoryProductRow {
  slug: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  best_price: string | number | null;
  stores_count: string | number | null;
  freshest_captured_at: Date | string | null;
}

export interface CategoryProductItem {
  slug: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  best_price: number | null;
  stores_count: number | null;
  freshest_captured_at: string | null;
}

/**
 * Lista los productos con precios frescos dentro de una categoría
 * (incluyendo subcategorías). Si la categoría no existe devuelve null.
 */
export async function listCategoryProducts(
  db: Kysely<DB>,
  categoryToken: string,
  opts: { limit?: number } = {},
): Promise<CategoryProductItem[] | null> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const cat = await sql<{ path: string }>`
    select path from category
    where slug = ${categoryToken} or path = ${categoryToken}
    order by case when path = ${categoryToken} then 0 else 1 end
    limit 1
  `.execute(db);

  const categoryPath = cat.rows[0]?.path ?? null;
  if (!categoryPath) return null;

  const rows = await sql<CategoryProductRow>`
    select distinct on (p.id)
           p.slug, p.canonical_name as name, p.brand, p.image_url,
           pa.best_price::float8 as best_price, pa.stores_count,
           pa.best_captured_at as freshest_captured_at
    from product p
    join price_aggregate pa on pa.product_id = p.id
    join category c on c.id = p.category_id
    where (c.path = ${categoryPath} or c.path like ${`${categoryPath}/%`})
      and pa.best_captured_at >= now() - ${freshWindowInterval}
    order by p.id, pa.best_price asc nulls last
    limit ${limit}
  `.execute(db);

  return rows.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    brand: r.brand,
    image_url: r.image_url,
    best_price: r.best_price == null ? null : Number(r.best_price),
    stores_count: r.stores_count == null ? null : Number(r.stores_count),
    freshest_captured_at: r.freshest_captured_at
      ? new Date(r.freshest_captured_at).toISOString()
      : null,
  }));
}
