import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';

const VALID_WINDOWS = new Set(['30', '90', 'all']);

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const db = getDb();
    const { slug } = await params;
    const window = (new URL(request.url).searchParams.get('window') ?? '30') as string;
    if (!VALID_WINDOWS.has(window)) {
      return errorResponse('invalid_query', "Parámetro window inválido (usar 30, 90 o 'all')", 400);
    }

    const product = await sql<{ id: string }>`
      select id::text as id from product where slug = ${slug} limit 1
    `.execute(db);
    const productId = product.rows[0]?.id;
    if (!productId) return errorResponse('not_found', `Producto '${slug}' no encontrado`, 404);

    const since =
      window === 'all' ? null : sql.raw(`now() - interval '${window === '30' ? 30 : 90} days'`);

    const seriesRows = await sql<{
      day: string;
      min_price: string | number;
      avg_price: string | number | null;
    }>`
      select day::text as day, min_price, avg_price
      from daily_series
      where product_id = ${productId}::bigint
        ${since ? sql`and day >= ${since}` : sql``}
      order by day asc
    `.execute(db);

    const agg = await sql<{
      min_30d: string | null;
      min_90d: string | null;
      avg_30d: string | null;
      pct_change_24h: string | null;
      pct_change_7d: string | null;
      best_price: string | null;
    }>`
      select min_30d, min_90d, avg_30d, pct_change_24h, pct_change_7d, best_price
      from price_aggregate where product_id = ${productId}::bigint limit 1
    `.execute(db);
    const stats = agg.rows[0];

    const series = seriesRows.rows.map((r) => ({
      date: r.day,
      min_price: Number(r.min_price),
      avg_price: r.avg_price === null ? null : Number(r.avg_price),
    }));

    const firstDate = series.length > 0 ? new Date(`${series[0]?.date}T00:00:00Z`) : null;
    const now = Date.now();
    const insufficientHistory = firstDate === null || now - firstDate.getTime() < 7 * 86_400_000;

    const windowPrices = series.map((p) => p.min_price);
    const minWindow = windowPrices.length > 0 ? Math.min(...windowPrices) : null;
    const maxWindow = windowPrices.length > 0 ? Math.max(...windowPrices) : null;

    const bestPrice = stats?.best_price != null ? Number(stats.best_price) : null;
    const min90 = stats?.min_90d != null ? Number(stats.min_90d) : null;

    return NextResponse.json({
      product_slug: slug,
      window,
      insufficient_history: insufficientHistory,
      series,
      stats: {
        min_window: minWindow,
        max_window: maxWindow,
        pct_change_24h: stats?.pct_change_24h != null ? Number(stats.pct_change_24h) : null,
        pct_change_7d: stats?.pct_change_7d != null ? Number(stats.pct_change_7d) : null,
        avg_30d: stats?.avg_30d != null ? Number(stats.avg_30d) : null,
        near_min_90d: bestPrice !== null && min90 !== null ? bestPrice <= min90 * 1.05 : null,
      },
    });
  } catch (err) {
    console.error('[history]', err);
    return errorResponse('internal_error', 'Error interno', 500);
  }
}
