import { sql, type Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import { loadOffersByProduct } from './offers';
import type { CardOffer } from '@/lib/types';

const DEFAULT_PAGE_SIZE = 10;

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
  opts: { page?: number; pageSize?: number } = {},
): Promise<CategoryProductPage | null> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? DEFAULT_PAGE_SIZE, 1), 60);
  const offset = (page - 1) * pageSize;

  const cat = await sql<{ path: string }>`
    select path from category
    where slug = ${categoryToken} or path = ${categoryToken}
    order by case when path = ${categoryToken} then 0 else 1 end
    limit 1
  `.execute(db);

  const categoryPath = cat.rows[0]?.path ?? null;
  if (!categoryPath) return null;

  const countRows = await sql<CategoryProductCountRow>`
    select count(*)::int as total
    from product p
    join category c on c.id = p.category_id
    join price_aggregate pa on pa.product_id = p.id
    where (c.path = ${categoryPath} or c.path like ${`${categoryPath}/%`})
      and pa.stores_count >= 2
  `.execute(db);
  const total = Number(countRows.rows[0]?.total ?? 0);

  const rows = await sql<CategoryProductRow>`
    select p.id, p.slug, p.canonical_name as name, p.brand, p.image_url,
           pa.best_price::float8 as best_price, pa.stores_count
    from product p
    join category c on c.id = p.category_id
    join price_aggregate pa on pa.product_id = p.id
    where (c.path = ${categoryPath} or c.path like ${`${categoryPath}/%`})
      and pa.stores_count >= 2
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
