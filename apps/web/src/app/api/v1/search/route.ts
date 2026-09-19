import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { jsonWithCache, SEARCH_JSON_CACHE } from '@/lib/http';
import { cachedSearchApi } from '@/lib/queries/cached';
import { resolveCategoryPath, type SearchApiParams } from '@/lib/queries/search';

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

    const params: SearchApiParams = { q, limit, offset, category: categoryPath, stores };
    const results = await cachedSearchApi(params);

    return jsonWithCache(
      {
        results,
        next_cursor: results.length === limit ? encodeCursor(offset + limit) : null,
      },
      SEARCH_JSON_CACHE,
    );
  } catch (err) {
    console.error('[search]', err);
    return errorResponse('internal_error', 'Error interno', 500);
  }
}
