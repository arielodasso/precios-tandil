import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { AppError, type DB } from '@precios/shared';
import { freshWindowInterval } from './freshness.ts';
import { cachedJson } from '../../plugins/cache.ts';

const SEARCH_CACHE_TTL_SECONDS = 5 * 60;

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const MIN_Q_LENGTH = 2;
const MAX_Q_LENGTH = 64;

export interface SearchHit {
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  best_price: number | null;
  stores_count: number | null;
  freshest_captured_at: string | null;
}

export interface SearchResponse {
  results: SearchHit[];
  next_cursor: string | null;
}

interface SearchQueryRow {
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  best_price: number | null;
  stores_count: number | null;
  freshest_captured_at: Date | string | null;
}

export interface SearchOptions {
  q: string;
  category?: string;
  stores?: string[];
  limit?: number;
  cursor?: string;
  resolvedOffset?: number;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

export function resolveCursorOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      o?: unknown;
    };
    if (
      typeof parsed?.o === 'number' &&
      Number.isInteger(parsed.o) &&
      parsed.o >= 0 &&
      parsed.o <= Number.MAX_SAFE_INTEGER
    ) {
      return parsed.o;
    }
  } catch {
    // cae al error de abajo
  }
  throw new AppError('invalid_query', 'Cursor inválido');
}

export function validateSearchQuery(
  query: Record<string, unknown>,
): Required<Pick<SearchOptions, 'q' | 'limit'>> &
  Pick<SearchOptions, 'category' | 'stores' | 'cursor'> {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q.length < MIN_Q_LENGTH || q.length > MAX_Q_LENGTH) {
    throw new AppError(
      'invalid_query',
      `El parámetro "q" es obligatorio y debe tener entre ${MIN_Q_LENGTH} y ${MAX_Q_LENGTH} caracteres`,
    );
  }

  let limit = DEFAULT_LIMIT;
  const rawLimit = query.limit;
  if (rawLimit !== undefined) {
    const parsed = typeof rawLimit === 'number' ? rawLimit : Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      throw new AppError('invalid_query', `"limit" debe ser un entero entre 1 y ${MAX_LIMIT}`);
    }
    limit = parsed;
  }

  let category: string | undefined;
  if (query.category !== undefined) {
    const raw = Array.isArray(query.category) ? String(query.category[0]) : String(query.category);
    category = raw.trim();
    if (category.length === 0 || category.length > 200) {
      throw new AppError('invalid_query', '"category" inválida');
    }
  }

  const rawStores = query.store;
  const storeList = (
    Array.isArray(rawStores) ? rawStores : rawStores === undefined ? [] : [rawStores]
  )
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0 && s.length <= 64);

  return {
    q,
    limit,
    category,
    stores: storeList.length > 0 ? storeList : undefined,
    cursor: query.cursor === undefined ? undefined : String(query.cursor),
  };
}

async function resolveCategoryPath(db: Kysely<DB>, token: string): Promise<string | null> {
  const rows = await sql<{ path: string }>`
    select path
    from category
    where slug = ${token} or path = ${token}
    order by case when path = ${token} then 0 else 1 end
    limit 1
  `.execute(db);
  return rows.rows[0]?.path ?? null;
}

export async function searchProducts(
  db: Kysely<DB>,
  options: SearchOptions,
): Promise<SearchResponse> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = options.resolvedOffset ?? resolveCursorOffset(options.cursor);
  const stores = options.stores ?? [];
  const q = options.q.trim();

  let categoryPath: string | null = null;
  if (options.category !== undefined) {
    categoryPath = await resolveCategoryPath(db, options.category);
    if (categoryPath === null) {
      return { results: [], next_cursor: null };
    }
  }

  const tsQuery = sql`websearch_to_tsquery('spanish', ${q})`;
  const storeFilter = stores.length > 0 ? sql`s.slug in (${stores})` : sql`true`;
  const categoryFilter =
    categoryPath !== null
      ? sql`and (c.path = ${categoryPath} or c.path like ${`${categoryPath}/%`})`
      : sql``;

  const result = await sql<SearchQueryRow>`
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
    where (p.search_vector @@ ${tsQuery} or p.canonical_name % ${q})
      and exists (select 1 from avail a where a.product_id = p.id)
      and pa.stores_count >= 2
      ${categoryFilter}
    order by greatest(
               ts_rank_cd(p.search_vector, ${tsQuery}),
               similarity(p.canonical_name, ${q})
             ) desc,
             pa.best_price asc
    limit ${limit} offset ${offset}
  `.execute(db);

  const results = result.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    category: row.category,
    image_url: row.image_url,
    best_price: row.best_price === null ? null : Math.round(Number(row.best_price) * 100) / 100,
    stores_count: row.stores_count,
    freshest_captured_at: row.freshest_captured_at
      ? new Date(row.freshest_captured_at).toISOString()
      : null,
  }));

  const nextCursor = results.length === limit ? encodeCursor(offset + limit) : null;
  return { results, next_cursor: nextCursor };
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search', async (request) => {
    const parsed = validateSearchQuery(request.query as Record<string, unknown>);
    resolveCursorOffset(parsed.cursor);
    return cachedJson(app, request, 'search', SEARCH_CACHE_TTL_SECONDS, () =>
      searchProducts(app.db, parsed),
    );
  });
}
