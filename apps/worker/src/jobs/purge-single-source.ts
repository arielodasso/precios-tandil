import { sql, type Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { DB } from '@precios/shared';
import { FRESH_WINDOW_DAYS, MIN_SHELF_PRICE } from './refresh-aggregates.ts';

export interface PurgeSingleSourceResult {
  purgedAt: Date;
  /** Registros históricos con precio < MIN_SHELF_PRICE (append-only: no se borran). */
  pricesBelowMin: number;
  productsPurged: number;
  matchLinksDeleted: number;
}

/**
 * Purga de productos de una sola fuente:
 *  - los productos que quedaron con menos de 2 tiendas con precio fresco y
 *    válido (>= MIN_SHELF_PRICE dentro de la ventana de frescura) se eliminan,
 *    incluyendo los que quedaron sin ninguna fuente. La definición de
 *    "fuente" es la misma que usa refresh-aggregates: match_link
 *    auto/confirmed + price_record no-suspect.
 *
 * NOTA (Constitution V): price_record es append-only y store_sku no se borra
 * porque es referenciado por price_record sin cascada. El registro histórico
 * y el SKU quedan como huérfanos en la base (auditable); se eliminan solo el
 * producto y los artefactos de vínculo/derivados (match_link, price_aggregate,
 * deals). El count sobre precios < MIN_SHELF_PRICE es informativo.
 */
export async function purgeSingleSource(
  db: Kysely<DB>,
  logger?: Logger,
  opts: { now?: Date } = {},
): Promise<PurgeSingleSourceResult> {
  const now = opts.now ?? new Date();
  const startedAt = Date.now();

  const counts = await db.transaction().execute(async (trx) => {
    const below = await sql<{ n: number }>`
      select count(*)::int as n
      from price_record
      where price_amount::numeric < ${MIN_SHELF_PRICE}
    `.execute(trx);

    const targetProducts = await sql<{ id: number }>`
      with sources as (
        select ml.product_id, count(distinct ss.store_id)::int as stores
        from match_link ml
        join store_sku ss on ss.id = ml.store_sku_id
        join price_record pr on pr.store_sku_id = ss.id
          and pr.is_suspect = false
          and pr.price_amount::numeric >= ${MIN_SHELF_PRICE}
          and pr.captured_at >= ${now}::timestamptz - interval '${sql.raw(String(FRESH_WINDOW_DAYS))} days'
        where ml.status in ('auto', 'confirmed')
        group by ml.product_id
      )
      select p.id
      from product p
      left join sources s on s.product_id = p.id
      where coalesce(s.stores, 0) < 2
    `.execute(trx);

    const productIds =
      targetProducts.rows.length > 0
        ? sql.raw(`(${targetProducts.rows.map((r) => Number(r.id)).join(', ')})`)
        : null;

    if (!productIds) {
      return {
        below: Number(below.rows[0]?.n ?? 0),
        products: 0,
        links: 0,
      };
    }

    const candidatesToDelete = sql`(
      select dc.id from deal_candidate dc where dc.product_id in ${productIds}
    )`;

    await sql`delete from deal_publication dp where dp.candidate_id in ${candidatesToDelete}`.execute(
      trx,
    );
    await sql`delete from deal_candidate where product_id in ${productIds}`.execute(trx);
    const links = await sql<{ deleted: number }>`
      with del as (
        delete from match_link where product_id in ${productIds}
        returning id
      )
      select count(*)::int as deleted from del
    `.execute(trx);
    await sql`delete from price_aggregate where product_id in ${productIds}`.execute(trx);
    await sql`delete from product where id in ${productIds}`.execute(trx);

    return {
      below: Number(below.rows[0]?.n ?? 0),
      products: targetProducts.rows.length,
      links: Number(links.rows[0]?.deleted ?? 0),
    };
  });

  const result: PurgeSingleSourceResult = {
    purgedAt: now,
    pricesBelowMin: counts.below,
    productsPurged: counts.products,
    matchLinksDeleted: counts.links,
  };

  logger?.info(
    {
      event: 'purge.single_source',
      durationMs: Date.now() - startedAt,
      ...result,
    },
    'purga de productos de una sola fuente completada',
  );

  return result;
}
