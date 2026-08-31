import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';

const FRESH_WINDOW_DAYS = 7;
const freshWindowInterval = sql.raw(`interval '${FRESH_WINDOW_DAYS} days'`);
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function resolveCursorOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed?.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) {
      return parsed.o;
    }
  } catch {
    /* fallthrough */
  }
  throw new Error('Cursor inválido');
}

async function resolveCategoryPath(
  db: ReturnType<typeof getDb>,
  token: string,
): Promise<string | null> {
  const rows = await sql<{ path: string }>`
    select path from category
    where slug = ${token} or path = ${token}
    order by case when path = ${token} then 0 else 1 end
    limit 1
  `.execute(db);
  return rows.rows[0]?.path ?? null;
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);

    const q = (searchParams.get('q') ?? '').trim();
    if (q.length < 2 || q.length > 64) {
      return errorResponse(
        'invalid_query',
        'El parámetro "q" es obligatorio y debe tener entre 2 y 64 caracteres',
        400,
      );
    }

    const rawLimit = Number(searchParams.get('limit'));
    const limit =
      Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= MAX_LIMIT
        ? rawLimit
        : DEFAULT_LIMIT;
    const offset = resolveCursorOffset(searchParams.get('cursor') ?? undefined);

    const category = searchParams.get('category')?.trim() || undefined;
    const storeParam = searchParams.getAll('store');
    const stores = storeParam.length > 0 ? storeParam : [];

    let categoryPath: string | null = null;
    if (category) {
      categoryPath = await resolveCategoryPath(db, category);
      if (!categoryPath) return NextResponse.json({ results: [], next_cursor: null });
    }

    const tsQuery = sql`websearch_to_tsquery('spanish', ${q})`;
    const storeFilter = stores.length > 0 ? sql`s.slug in (${stores})` : sql`true`;
    const categoryFilter =
      categoryPath !== null
        ? sql`and (c.path = ${categoryPath} or c.path like ${`${categoryPath}/%`})`
        : sql``;

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
        join match_link ml on ml.store_sku_id = ss.id and ml.status <> 'rejected'
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

    return NextResponse.json({
      results,
      next_cursor: results.length === limit ? encodeCursor(offset + limit) : null,
    });
  } catch (err) {
    console.error('[search]', err);
    return errorResponse('internal_error', 'Error interno', 500);
  }
}
