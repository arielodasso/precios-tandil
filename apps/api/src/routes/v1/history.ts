import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import { AppError } from '@precios/shared';
import { cachedJson } from '../../plugins/cache.ts';

const HISTORY_CACHE_TTL_SECONDS = 3_600;
const VALID_WINDOWS = new Set(['30', '90', 'all']);

interface HistorySeriesRow {
  day: string;
  min_price: string | number;
  avg_price: string | number | null;
}

interface AggregateRow {
  min_30d: string | null;
  min_90d: string | null;
  avg_30d: string | null;
  pct_change_24h: string | null;
  pct_change_7d: string | null;
  best_price: string | null;
}

interface ProductIdRow {
  id: string;
}

export interface HistoryResponse {
  product_slug: string;
  window: '30' | '90' | 'all';
  insufficient_history: boolean;
  series: Array<{ date: string; min_price: number; avg_price: number | null }>;
  stats: {
    min_window: number | null;
    max_window: number | null;
    pct_change_24h: number | null;
    pct_change_7d: number | null;
    avg_30d: number | null;
    near_min_90d: boolean | null;
  };
}

export function parseHistoryWindow(raw: unknown): '30' | '90' | 'all' {
  const value = String(raw ?? '30');
  if (!VALID_WINDOWS.has(value)) {
    throw new AppError('invalid_query', "Parámetro window inválido (usar 30, 90 o 'all')");
  }
  return value as '30' | '90' | 'all';
}

/**
 * T053 + T055 — GET /products/:slug/history?window=
 * Serie diaria servida desde daily_series + métricas de price_aggregate.
 * Regla "datos insuficientes": <7 días de historia marca
 * insufficient_history=true (la UI muestra aviso).
 */
export async function getProductHistory(
  db: Kysely<DB>,
  slug: string,
  window: '30' | '90' | 'all',
  now = new Date(),
): Promise<HistoryResponse> {
  const product = await sql<ProductIdRow>`
    select id::text as id from product where slug = ${slug} limit 1
  `.execute(db);
  const productId = product.rows[0]?.id;
  if (!productId) {
    throw new AppError('not_found', `Producto '${slug}' no encontrado`);
  }

  const since =
    window === 'all' ? null : sql.raw(`now() - interval '${window === '30' ? 30 : 90} days'`);

  const seriesRows = await sql<HistorySeriesRow>`
    select day::text as day,
           min_price,
           avg_price
    from daily_series
    where product_id = ${productId}::bigint
      ${since ? sql`and day >= ${since}` : sql``}
    order by day asc
  `.execute(db);

  const agg = await sql<AggregateRow>`
    select min_30d, min_90d, avg_30d, pct_change_24h, pct_change_7d, best_price
    from price_aggregate
    where product_id = ${productId}::bigint
    limit 1
  `.execute(db);
  const stats = agg.rows[0];

  const series = seriesRows.rows.map((r) => ({
    date: r.day,
    min_price: Number(r.min_price),
    avg_price: r.avg_price === null ? null : Number(r.avg_price),
  }));

  // Regla de datos insuficientes: primer punto con menos de 7 días de antigüedad.
  const firstDate = series.length > 0 ? new Date(`${series[0]?.date}T00:00:00Z`) : null;
  const insufficientHistory =
    firstDate === null || now.getTime() - firstDate.getTime() < 7 * 86_400_000;

  const windowPrices = series.map((p) => p.min_price);
  const minWindow = windowPrices.length > 0 ? Math.min(...windowPrices) : null;
  const maxWindow = windowPrices.length > 0 ? Math.max(...windowPrices) : null;

  const bestPrice =
    stats?.best_price !== null && stats?.best_price !== undefined ? Number(stats.best_price) : null;
  const min90 =
    stats?.min_90d !== null && stats?.min_90d !== undefined ? Number(stats.min_90d) : null;

  return {
    product_slug: slug,
    window,
    insufficient_history: insufficientHistory,
    series,
    stats: {
      min_window: minWindow,
      max_window: maxWindow,
      pct_change_24h:
        stats?.pct_change_24h === null || stats?.pct_change_24h === undefined
          ? null
          : Number(stats.pct_change_24h),
      pct_change_7d:
        stats?.pct_change_7d === null || stats?.pct_change_7d === undefined
          ? null
          : Number(stats.pct_change_7d),
      avg_30d:
        stats?.avg_30d === null || stats?.avg_30d === undefined ? null : Number(stats.avg_30d),
      near_min_90d: bestPrice !== null && min90 !== null ? bestPrice <= min90 * 1.05 : null,
    },
  };
}

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { window?: string } }>(
    '/products/:slug/history',
    async (request) => {
      const { slug } = request.params;
      const window = parseHistoryWindow(request.query.window);
      return cachedJson(app, request, `history:${slug}:${window}`, HISTORY_CACHE_TTL_SECONDS, () =>
        getProductHistory(app.db, slug, window),
      );
    },
  );
}
