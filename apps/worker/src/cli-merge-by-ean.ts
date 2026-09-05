/**
 * Fusión de productos duplicados que comparten el mismo EAN.
 *
 * Detecta productos que representan el MISMO artículo físico (mismo EAN-13
 * válido) pero quedaron como registros separados porque el matching semántico
 * no los unió (nombres que difieren en formateo entre tiendas, pool de
 * candidatos limitado, etc.). El EAN idéntico es la señal más fuerte de que
 * es el mismo producto, así que se fusionan con seguridad.
 *
 * Regla de seguridad: NO fusiona dos productos del mismo EAN si ambos tienen
 * SKUs en la MISMA tienda (eso indicaría un EAN compartido fraudulento o un
 * error del catálogo de origen).
 *
 * Uso:
 *   pnpm --filter @precios/worker merge-by-ean            # dry-run (reporta)
 *   pnpm --filter @precios/worker merge-by-ean --apply     # ejecuta los cambios
 */
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { isValidEan13 } from '@precios/normalizer';

const APPLY = process.argv.includes('--apply');

interface ProductRow {
  id: number;
  ean: string | null;
  canonical_name: string;
  category_id: number | null;
  created_at: Date;
  updated_at: Date;
}

interface LinkRow {
  product_id: number;
  store_id: number;
}

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

const counts = {
  groups: 0,
  merged: 0,
  movedLinks: 0,
  movedDeals: 0,
  removedAggregates: 0,
  skipped: 0,
};

function dateOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

async function run() {
  const products = (await db
    .selectFrom('product')
    .select(['id', 'ean', 'canonical_name', 'category_id', 'created_at', 'updated_at'])
    .execute()) as unknown as ProductRow[];

  const links = (await db
    .selectFrom('match_link')
    .innerJoin('store_sku', 'store_sku.id', 'match_link.store_sku_id')
    .select(['match_link.product_id', 'store_sku.store_id'])
    .execute()) as unknown as LinkRow[];

  const linkCountByProduct = new Map<number, number>();
  const storesByProduct = new Map<number, Set<number>>();
  for (const l of links) {
    const pid = Number(l.product_id);
    const n = linkCountByProduct.get(pid) ?? 0;
    linkCountByProduct.set(pid, n + 1);
    const set = storesByProduct.get(pid) ?? new Set<number>();
    set.add(Number(l.store_id));
    storesByProduct.set(pid, set);
  }

  // Agrupar por EAN válido.
  const byEan = new Map<string, ProductRow[]>();
  for (const p of products) {
    const ean = p.ean ? String(p.ean).trim() : '';
    if (!isValidEan13(ean)) continue;
    const arr = byEan.get(ean) ?? [];
    arr.push(p);
    byEan.set(ean, arr);
  }

  for (const [, group] of byEan) {
    if (group.length < 2) continue;

    // Regla de seguridad: no fusionar si dos productos del mismo EAN comparten
    // alguna tienda (posible EAN compartido/erróneo dentro de la misma fuente).
    const seenStores = new Map<number, number>(); // storeId -> productId dueño
    let conflict = false;
    for (const p of group) {
      const stores = storesByProduct.get(p.id) ?? new Set<number>();
      for (const st of stores) {
        if (seenStores.has(st)) {
          conflict = true;
          break;
        }
        seenStores.set(st, p.id);
      }
      if (conflict) break;
    }
    if (conflict) {
      counts.skipped++;
      logger.warn(
        { ean: group[0]!.ean, ids: group.map((g) => g.id) },
        'merge-by-ean: grupo omitido (misma tienda, EAN sospechoso)',
      );
      continue;
    }

    // Keeper: el de más enlaces, luego mayor updated_at, luego el más actual.
    const sorted = [...group].sort((a, b) => {
      const la = linkCountByProduct.get(a.id) ?? 0;
      const lb = linkCountByProduct.get(b.id) ?? 0;
      if (la !== lb) return lb - la;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    const keeper = sorted[0]!;
    const secondaries = sorted.slice(1);
    counts.groups++;

    logger.info(
      {
        ean: keeper.ean,
        keeper: keeper.id,
        keeperName: keeper.canonical_name,
        merged: secondaries.map((s) => s.id),
      },
      APPLY ? 'merge-by-ean: fusionando' : 'merge-by-ean: would-merge',
    );
    if (!APPLY) {
      counts.merged += secondaries.length;
      continue;
    }

    try {
      await db.transaction().execute(async (trx) => {
        const moved = await trx
          .updateTable('match_link')
          .set({ product_id: keeper.id })
          .where(
            'product_id',
            'in',
            secondaries.map((s) => s.id),
          )
          .execute();
        counts.movedLinks += moved.reduce((acc, r) => acc + Number(r.numUpdatedRows ?? 0), 0);

        const dealRows = await trx
          .selectFrom('deal_candidate')
          .select(['id', 'detected_at'])
          .where(
            'product_id',
            'in',
            secondaries.map((s) => s.id),
          )
          .execute();
        if (dealRows.length > 0) {
          const keeperDates = new Set(
            (
              await trx
                .selectFrom('deal_candidate')
                .select('detected_at')
                .where('product_id', '=', keeper.id)
                .execute()
            ).map((d) => dateOf(d.detected_at)),
          );
          const movableIds = dealRows
            .filter((d) => !keeperDates.has(dateOf(d.detected_at)))
            .map((d) => d.id);
          if (movableIds.length > 0) {
            await trx
              .updateTable('deal_candidate')
              .set({ product_id: keeper.id })
              .where('id', 'in', movableIds)
              .execute();
            counts.movedDeals += movableIds.length;
          }
          const remainingIds = dealRows.filter((d) => !movableIds.includes(d.id)).map((d) => d.id);
          if (remainingIds.length > 0) {
            await trx.deleteFrom('deal_candidate').where('id', 'in', remainingIds).execute();
          }
        }

        await trx
          .deleteFrom('price_aggregate')
          .where(
            'product_id',
            'in',
            secondaries.map((s) => s.id),
          )
          .execute();
        counts.removedAggregates += secondaries.length;
        await trx
          .deleteFrom('product')
          .where(
            'id',
            'in',
            secondaries.map((s) => s.id),
          )
          .execute();
        counts.merged += secondaries.length;
      });
    } catch (err) {
      logger.warn(
        { keeper: keeper.id, secondaries: secondaries.map((s) => s.id), err },
        'merge-by-ean: grupo omitido por error',
      );
    }
  }

  logger.info(
    { ...counts, totalEanGroups: byEan.size },
    APPLY ? 'merge-by-ean: resumen aplicado' : 'merge-by-ean: resumen dry-run',
  );
}

run()
  .catch((err) => {
    logger.error({ err }, 'merge-by-ean falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
