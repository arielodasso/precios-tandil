import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { DB } from '@precios/shared';

/** Ventana de frescura: >7 días excluye la tienda del ranking de mejor precio (data-model.md). */
export const FRESH_WINDOW_DAYS = 7;

/** Precio mínimo de venta al público (ARS). Precios menores se consideran datos inválidos. */
export const MIN_SHELF_PRICE = 500;

export interface RefreshAggregatesResult {
  refreshedAt: Date;
  /** Productos con ofertas frescas cuyo agregado fue escrito/actualizado. */
  productsUpdated: number;
  /** Agregados eliminados por quedarse sin datos frescos (productos rancios). */
  productsRemoved: number;
}

interface RefreshCounts {
  updated: number;
  removed: number;
}

/**
 * T035 + T051 — Agregados por producto unificado:
 *  - mejor precio vigente entre tiendas con datos frescos (< FRESH_WINDOW_DAYS),
 *  - tienda ganadora y su captured_at, stores_count,
 *  - métricas históricas: min_30d/min_90d/min_all_time, avg_30d,
 *    pct_change_24h y pct_change_7d (precio actual vs último precio válido
 *    anterior a 24h / 7 días), excluyendo suspects y matches rechazados.
 */
export async function refreshAggregates(
  db: Kysely<DB>,
  logger?: Logger,
  opts: { now?: Date } = {},
): Promise<RefreshAggregatesResult> {
  const now = opts.now ?? new Date();
  const startedAt = Date.now();

  const counts = await db.transaction().execute(async (trx) => {
    const result = await sql<RefreshCounts>`
      with latest as (
        select ml.product_id,
               ss.store_id,
               pr.price_amount,
               pr.captured_at,
               row_number() over (
                 partition by ml.product_id, ss.store_id
                 order by pr.captured_at desc,
                          case when pr.list_or_promo = 'promo' then 0 else 1 end,
                          pr.price_amount asc
               ) as rn
        from match_link ml
        join store_sku ss on ss.id = ml.store_sku_id
        join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
          and pr.price_amount::numeric >= ${MIN_SHELF_PRICE}
        where ml.status in ('auto', 'confirmed')
      ),
      fresh as (
        select product_id, store_id, price_amount, captured_at
        from latest
        where rn = 1
          and captured_at >= ${now}::timestamptz - interval '${sql.raw(String(FRESH_WINDOW_DAYS))} days'
      ),
      per_product as (
        select product_id, count(distinct store_id)::int as stores_count
        from fresh
        group by product_id
      ),
      best as (
        select distinct on (product_id)
               product_id,
               store_id as best_store_id,
               price_amount as best_price,
               captured_at as best_captured_at
        from fresh
        order by product_id, price_amount asc, captured_at desc, store_id asc
      ),
      history as (
        select ml.product_id,
               min(pr.price_amount) filter (
                 where pr.captured_at >= ${now}::timestamptz - interval '30 days'
               ) as min_30d,
               min(pr.price_amount) filter (
                 where pr.captured_at >= ${now}::timestamptz - interval '90 days'
               ) as min_90d,
               min(pr.price_amount) as min_all_time,
               round(avg(pr.price_amount) filter (
                 where pr.captured_at >= ${now}::timestamptz - interval '30 days'
               ), 2) as avg_30d
        from match_link ml
        join store_sku ss on ss.id = ml.store_sku_id
        join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
          and pr.price_amount::numeric >= ${MIN_SHELF_PRICE}
        where ml.status in ('auto', 'confirmed')
        group by ml.product_id
      ),
      ref_24h as (
        select distinct on (ml.product_id)
               ml.product_id, pr.price_amount
        from match_link ml
        join store_sku ss on ss.id = ml.store_sku_id
        join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
          and pr.price_amount::numeric >= ${MIN_SHELF_PRICE}
        where ml.status in ('auto', 'confirmed')
          and pr.captured_at <= ${now}::timestamptz - interval '24 hours'
        order by ml.product_id, pr.captured_at desc
      ),
      ref_7d as (
        select distinct on (ml.product_id)
               ml.product_id, pr.price_amount
        from match_link ml
        join store_sku ss on ss.id = ml.store_sku_id
        join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
          and pr.price_amount::numeric >= ${MIN_SHELF_PRICE}
        where ml.status in ('auto', 'confirmed')
          and pr.captured_at <= ${now}::timestamptz - interval '7 days'
        order by ml.product_id, pr.captured_at desc
      ),
      removed as (
        delete from price_aggregate pa
        where not exists (select 1 from fresh f where f.product_id = pa.product_id)
        returning pa.product_id
      ),
      upserted as (
        insert into price_aggregate
          (product_id, best_store_id, best_price, best_captured_at, stores_count, refreshed_at,
           min_30d, min_90d, min_all_time, avg_30d, pct_change_24h, pct_change_7d)
        select b.product_id, b.best_store_id, b.best_price, b.best_captured_at, p.stores_count, ${now},
               h.min_30d, h.min_90d, h.min_all_time, h.avg_30d,
               case when r24.price_amount > 0
                    then round(((b.best_price - r24.price_amount) / r24.price_amount * 100)::numeric, 2)
                    else null end as pct_change_24h,
               case when r7.price_amount > 0
                    then round(((b.best_price - r7.price_amount) / r7.price_amount * 100)::numeric, 2)
                    else null end as pct_change_7d
        from best b
        join per_product p on p.product_id = b.product_id
        left join history h on h.product_id = b.product_id
        left join ref_24h r24 on r24.product_id = b.product_id
        left join ref_7d r7 on r7.product_id = b.product_id
        on conflict (product_id) do update set
          best_store_id = excluded.best_store_id,
          best_price = excluded.best_price,
          best_captured_at = excluded.best_captured_at,
          stores_count = excluded.stores_count,
          refreshed_at = excluded.refreshed_at,
          min_30d = excluded.min_30d,
          min_90d = excluded.min_90d,
          min_all_time = excluded.min_all_time,
          avg_30d = excluded.avg_30d,
          pct_change_24h = excluded.pct_change_24h,
          pct_change_7d = excluded.pct_change_7d
        returning product_id
      )
      select (select count(*) from upserted)::int as updated,
             (select count(*) from removed)::int as removed
    `.execute(trx);

    return result.rows[0] ?? { updated: 0, removed: 0 };
  });

  const result: RefreshAggregatesResult = {
    refreshedAt: now,
    productsUpdated: Number(counts.updated),
    productsRemoved: Number(counts.removed),
  };

  logger?.info(
    {
      event: 'aggregates.refreshed',
      durationMs: Date.now() - startedAt,
      ...result,
    },
    'agregados de precios refrescados',
  );

  return result;
}
