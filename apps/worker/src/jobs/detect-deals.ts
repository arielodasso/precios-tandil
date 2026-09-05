import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { DB } from '@precios/shared';
import { FRESH_WINDOW_DAYS } from './refresh-aggregates.ts';

/** Umbral de descuento mínimo vs avg_30d para considerar oportunidad (US3: 15%). */
export const DEAL_DISCOUNT_THRESHOLD = 0.15;
/** Mínimo de tiendas con oferta fresca para proponer (evita ruido de una sola tienda). */
export const DEAL_MIN_STORES = 2;
/** Días antes de volver a proponer un candidato rechazado por el admin. */
export const DEAL_REJECT_COOLDOWN_DAYS = 14;

export interface DealCandidateInput {
  productId: string;
  bestPrice: number;
  avg30d: number | null;
  storesCount: number;
  pendingOrPublished: boolean;
  rejectedUntil: Date | null;
}

export interface DealDecision {
  discountPct: number;
}

/**
 * T058 — Reglas puras del detector de oportunidades:
 *  - descuento >= 15% del mejor precio vigente vs avg_30d;
 *  - >= 2 tiendas con oferta fresca;
 *  - sin candidato pendiente/publicado duplicado;
 *  - no re-proponer un rechazado dentro de los 14 días.
 */
export function decideDeal(input: DealCandidateInput, now: Date): DealDecision | null {
  if (input.avg30d === null || input.avg30d <= 0) return null;
  if (input.storesCount < DEAL_MIN_STORES) return null;
  if (input.pendingOrPublished) return null;
  if (input.rejectedUntil && input.rejectedUntil.getTime() > now.getTime()) return null;
  if (input.bestPrice >= input.avg30d) return null;
  const discountPct = ((input.avg30d - input.bestPrice) / input.avg30d) * 100;
  if (discountPct / 100 < DEAL_DISCOUNT_THRESHOLD) return null;
  return { discountPct: Math.round(discountPct * 100) / 100 };
}

export interface DetectDealsResult {
  detectedAt: Date;
  candidatesCreated: number;
}

interface CandidateRow {
  product_id: string;
  best_price: string | number;
  avg_30d: string | number | null;
  stores_count: number;
  evidence_stores: unknown;
}

/**
 * T058 — Job diario de detección: cruza ofertas frescas con price_aggregate
 * y crea deal_candidate en estado pending con evidencia JSON (ofertas,
 * tiendas, avg_30d). El admin publica o rechaza desde /admin.
 */
export async function detectDeals(
  db: Kysely<DB>,
  logger?: Logger,
  opts: { now?: Date } = {},
): Promise<DetectDealsResult> {
  const now = opts.now ?? new Date();
  const startedAt = Date.now();

  const rows = await sql<CandidateRow>`
    with latest as (
      select ml.product_id,
             ss.store_id,
             pr.price_amount,
             pr.captured_at,
             row_number() over (
               partition by ml.product_id, ss.store_id
               order by pr.captured_at desc,
                        case when pr.list_or_promo = 'promo' then 0 else 1 end
             ) as rn
      from match_link ml
      join store_sku ss on ss.id = ml.store_sku_id
      join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
      where ml.status in ('auto', 'confirmed')
    ),
    fresh as (
      select product_id, store_id, price_amount, captured_at
      from latest
      where rn = 1
        and price_amount::numeric >= 500
        and captured_at >= ${now}::timestamptz - interval '${sql.raw(String(FRESH_WINDOW_DAYS))} days'
    ),
    stats as (
      select f.product_id,
             min(f.price_amount)::numeric as best_price,
             count(distinct f.store_id)::int as stores_count,
             jsonb_agg(jsonb_build_object(
               'store_slug', s.slug,
               'price', f.price_amount,
               'captured_at', f.captured_at
             ) order by f.price_amount asc) as evidence_stores
      from fresh f
      join store s on s.id = f.store_id
      group by f.product_id
    )
    select st.product_id,
           st.best_price,
           pa.avg_30d,
           st.stores_count,
           st.evidence_stores
    from stats st
    join price_aggregate pa on pa.product_id = st.product_id
    where not exists (
      select 1 from deal_candidate dc
      where dc.product_id = st.product_id and dc.status in ('pending', 'published')
    )
    order by st.product_id asc
  `.execute(db);

  const rejectState = await sql<{ product_id: string; rejected_until: Date | null }>`
    select distinct on (product_id) product_id, rejected_until
    from deal_candidate
    where status = 'rejected'
    order by product_id, detected_at desc
  `.execute(db);

  const rejectedUntilByProduct = new Map<string, Date | null>();
  for (const row of rejectState.rows) {
    rejectedUntilByProduct.set(row.product_id, row.rejected_until ?? null);
  }

  let candidatesCreated = 0;
  for (const row of rows.rows) {
    const decision = decideDeal(
      {
        productId: row.product_id,
        bestPrice: Number(row.best_price),
        avg30d: row.avg_30d === null ? null : Number(row.avg_30d),
        storesCount: Number(row.stores_count),
        pendingOrPublished: false,
        rejectedUntil: rejectedUntilByProduct.get(row.product_id) ?? null,
      },
      now,
    );
    if (!decision) continue;

    await sql`
      insert into deal_candidate
        (product_id, detected_at, discount_pct, evidence, status)
      values (${row.product_id}, ${now}, ${decision.discountPct},
              ${JSON.stringify({
                best_price: Number(row.best_price),
                avg_30d: row.avg_30d === null ? null : Number(row.avg_30d),
                stores_count: Number(row.stores_count),
                offers: row.evidence_stores,
              })}::jsonb,
              'pending')
      on conflict do nothing
    `.execute(db);
    candidatesCreated += 1;
  }

  logger?.info(
    { event: 'deals.detected', durationMs: Date.now() - startedAt, candidatesCreated },
    'detección de oportunidades completada',
  );
  return { detectedAt: now, candidatesCreated };
}
