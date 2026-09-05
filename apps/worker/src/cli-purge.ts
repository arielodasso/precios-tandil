/**
 * Purga de productos de una sola fuente y de precios por debajo del mínimo.
 *
 * Uso:
 *   pnpm --filter @precios/worker purge          # dry-run (reporta objetivos)
 *   pnpm --filter @precios/worker purge --apply   # ejecuta los cambios
 */
import { sql } from 'kysely';
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { purgeSingleSource } from './jobs/purge-single-source.ts';
import { FRESH_WINDOW_DAYS, MIN_SHELF_PRICE } from './jobs/refresh-aggregates.ts';

const APPLY = process.argv.includes('--apply');

async function run() {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  try {
    if (!APPLY) {
      const below = await sql<{ n: number }>`
        select count(*)::int as n from price_record where price_amount::numeric < ${MIN_SHELF_PRICE}
      `.execute(db);
      const targets = await sql<{ n: number }>`
        with sources as (
          select ml.product_id, count(distinct ss.store_id)::int as stores
          from match_link ml
          join store_sku ss on ss.id = ml.store_sku_id
          join price_record pr on pr.store_sku_id = ss.id
            and pr.is_suspect = false
            and pr.price_amount::numeric >= ${MIN_SHELF_PRICE}
            and pr.captured_at >= now() - interval '${sql.raw(String(FRESH_WINDOW_DAYS))} days'
          where ml.status in ('auto', 'confirmed')
          group by ml.product_id
        )
        select count(*)::int as n
        from product p
        left join sources s on s.product_id = p.id
        where coalesce(s.stores, 0) < 2
      `.execute(db);
      logger.info(
        {
          prices_below_min: below.rows[0]?.n ?? 0,
          single_source_products: targets.rows[0]?.n ?? 0,
        },
        'purge: dry-run (usar --apply para ejecutar)',
      );
    } else {
      const result = await purgeSingleSource(db, logger);
      logger.info({ ...result }, 'purge: aplicado');
    }
  } finally {
    await db.destroy();
  }
}

run().catch((err) => {
  logger.error({ err }, 'purge falló');
  process.exitCode = 1;
});
