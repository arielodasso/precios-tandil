/**
 * Consolidación de productos duplicados entre tiendas.
 *
 * Detecta productos que representan el MISMO artículo físico vendido por
 * distintas tiendas (p.ej. "pure de tomate arcor brik 520g" de Vea vs
 * "pure tomate arcor brik" de Golopolis) y los fusiona en un único producto
 * canónico. A diferencia de cli-reconcile (que solo fusiona por EAN idéntico),
 * esto usa similitud semántica con exigencia de marca + medida compatibles.
 *
 * Resultado: cada producto gana más enlaces de tiendas (sube stores_count),
 * las categorías se pueblan y la canasta por tienda usa los mismos productos.
 *
 * Uso:
 *   pnpm --filter @precios/worker consolidate             # dry-run (reporta)
 *   pnpm --filter @precios/worker consolidate --apply     # ejecuta los cambios
 */
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { normalizeDescription, semanticScore, type MatchCandidate } from '@precios/normalizer';

const APPLY = process.argv.includes('--apply');
const NAME_THRESHOLD = 0.86; // dice sobre nombre normalizado
const SEMANTIC_THRESHOLD = 0.8;

interface ProductRow {
  id: number;
  ean: string | null;
  canonical_name: string;
  brand: string | null;
  unit_amount: string | null;
  unit_type: string | null;
  image_hash: string | null;
  image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

interface SkuRow {
  product_id: number;
  store_id: number;
  slug: string;
}

function normToCandidate(p: ProductRow): MatchCandidate {
  const norm = normalizeDescription(p.canonical_name, { brand: p.brand });
  return {
    productId: p.id,
    ean: p.ean,
    normName: norm.normName,
    unitAmount: p.unit_amount !== null ? Number(p.unit_amount) : null,
    unitType: p.unit_type,
    brand: p.brand,
    brandProvided: norm.brandProvided,
    typeKeys: norm.typeKeys,
    imageHash: p.image_hash,
    imageUrl: p.image_url,
    contextText: norm.contextText,
  };
}

function sameUnitStr(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a === b;
}

function diceBigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    map.set(bg, (map.get(bg) ?? 0) + 1);
  }
  return map;
}

function diceFromBigrams(ga: Map<string, number>, gb: Map<string, number>): number {
  let intersection = 0;
  let total = 0;
  for (const c of ga.values()) total += c;
  for (const c of gb.values()) total += c;
  if (total === 0) return 0;
  for (const [bg, count] of ga) {
    const other = gb.get(bg) ?? 0;
    intersection += Math.min(count, other);
  }
  return (2 * intersection) / total;
}

/** ¿Son el mismo artículo? Exige marca y medida compatibles + nombres parecidos. */
function isSameArticle(
  a: {
    norm: ReturnType<typeof normalizeDescription>;
    cand: MatchCandidate;
    unitStr: string | null;
  },
  b: {
    norm: ReturnType<typeof normalizeDescription>;
    cand: MatchCandidate;
    unitStr: string | null;
  },
  nameDice: number,
): boolean {
  if (nameDice < NAME_THRESHOLD) return false;

  // Medida: si ambas tienen medida, debe coincidir exacta.
  const aHasUnit = a.norm.unitType !== null || a.norm.unitAmount !== null;
  const bHasUnit = b.norm.unitType !== null || b.norm.unitAmount !== null;
  if (aHasUnit && bHasUnit) {
    if (a.norm.unitType !== b.norm.unitType) return false;
    if (!sameUnitStr(a.unitStr, b.unitStr)) return false;
    if (!a.norm.unitAmount || !b.norm.unitAmount || a.norm.unitAmount !== b.norm.unitAmount)
      return false;
  }

  // Marca: si ambas tienen marca declarada, deben coincidir (o faltar ambas).
  const aBrand = a.norm.brand;
  const bBrand = b.norm.brand;
  if (aBrand && bBrand && aBrand !== bBrand) return false;

  const score = semanticScore(a.norm, b.cand);
  if (score < SEMANTIC_THRESHOLD) return false;

  // Unidad detectada en una sola no debe vencer si los nombres son casi idénticos.
  if (aHasUnit !== bHasUnit && nameDice < 0.93) return false;

  return true;
}

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

const counts = { groups: 0, merged: 0, movedLinks: 0, movedDeals: 0, removedAggregates: 0 };

async function run() {
  const products = (await db
    .selectFrom('product')
    .select([
      'id',
      'ean',
      'canonical_name',
      'brand',
      'unit_amount',
      'unit_type',
      'image_hash',
      'image_url',
      'created_at',
      'updated_at',
    ])
    .execute()) as unknown as ProductRow[];

  const skus = (await db
    .selectFrom('match_link')
    .innerJoin('store_sku', 'store_sku.id', 'match_link.store_sku_id')
    .innerJoin('store', 'store.id', 'store_sku.store_id')
    .select(['match_link.product_id', 'store_sku.store_id', 'store.slug'])
    .where('match_link.status', '<>', 'rejected')
    .execute()) as unknown as SkuRow[];

  const skuCountByProduct = new Map<number, number>();
  for (const s of skus) {
    const pid = Number(s.product_id);
    skuCountByProduct.set(pid, (skuCountByProduct.get(pid) ?? 0) + 1);
  }
  const storesByProduct = new Map<number, Set<number>>();
  for (const s of skus) {
    const pid = Number(s.product_id);
    const set = storesByProduct.get(pid) ?? new Set<number>();
    set.add(Number(s.store_id));
    storesByProduct.set(pid, set);
  }

  logger.info(
    { dryRun: !APPLY, products: products.length, skus: skus.length },
    'consolidate: inicio',
  );

  // Precomputa normalización + bigrams por producto.
  const meta = new Map<
    number,
    { norm: ReturnType<typeof normalizeDescription>; cand: MatchCandidate; unitStr: string | null }
  >();
  const bigrams = new Map<number, Map<string, number>>();
  for (const p of products) {
    const norm = normalizeDescription(p.canonical_name, { brand: p.brand });
    const unitStr =
      p.unit_type && p.unit_amount
        ? `${p.unit_type}:${(Number(p.unit_amount) * 1000).toFixed(0)}`
        : null;
    meta.set(p.id, {
      norm,
      cand: normToCandidate(p),
      unitStr,
    });
    bigrams.set(p.id, diceBigrams(norm.normName));
  }

  // Bucket por medida + marca (menos esporádico que el tipo, reduce pares).
  const buckets = new Map<string, number[]>();
  for (const p of products) {
    const m = meta.get(p.id)!;
    const key = `${m.unitStr ?? 'no-unit'}|${m.norm.brand ?? 'no-brand'}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p.id);
    buckets.set(key, arr);
  }

  const DSU = new Map<number, number>();
  for (const p of products) DSU.set(p.id, p.id);
  function find(x: number): number {
    if (DSU.get(x) !== x) DSU.set(x, find(DSU.get(x)!));
    return DSU.get(x)!;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) DSU.set(rb, ra);
  }

  let comparisons = 0;
  let pairs = 0;

  // Comparar productos dentro de cada bucket (dice sobre bigrams cacheados).
  for (const [, ids] of buckets) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        comparisons++;
        const a = meta.get(ids[i]!);
        const b = meta.get(ids[j]!);
        if (!a || !b) continue;
        // No fusionar si ya están en la misma tienda: distinto artículo.
        const sa = storesByProduct.get(ids[i]!);
        const sb = storesByProduct.get(ids[j]!);
        let overlap = false;
        if (sa && sb) {
          for (const st of sa) {
            if (sb.has(st)) {
              overlap = true;
              break;
            }
          }
        }
        if (overlap) continue;
        const nameDice = diceFromBigrams(bigrams.get(ids[i]!)!, bigrams.get(ids[j]!)!);
        if (isSameArticle(a, b, nameDice)) {
          pairs++;
          union(ids[i]!, ids[j]!);
        }
      }
    }
  }

  // Agrupar por raíz.
  const groups = new Map<number, number[]>();
  for (const p of products) {
    const root = find(p.id);
    const arr = groups.get(root) ?? [];
    arr.push(p.id);
    groups.set(root, arr);
  }
  const candidateGroups = [...groups.values()].filter((g) => g.length > 1);

  logger.info(
    { comparisons, pairs, duplicateGroups: candidateGroups.length },
    'consolidate: grupos detectados',
  );

  for (const group of candidateGroups) {
    // Producto canónico: el de más enlaces (SKUs), luego el más actualizado.
    const sorted = [...group].sort((x, y) => {
      const lx = skuCountByProduct.get(x) ?? 0;
      const ly = skuCountByProduct.get(y) ?? 0;
      if (lx !== ly) return ly - lx;
      const tx = meta.get(x)!.cand.normName.length;
      const ty = meta.get(y)!.cand.normName.length;
      return ty - tx;
    });
    const keeper = sorted[0]!;
    const secondaries = sorted.slice(1);
    counts.groups++;
    logger.info(
      { keeper: keeper, merged: secondaries, name: meta.get(keeper)!.cand.normName },
      APPLY ? 'consolidate: fusionando' : 'consolidate: would-merge',
    );

    if (!APPLY) {
      counts.merged += secondaries.length;
      continue;
    }

    try {
      await db.transaction().execute(async (trx) => {
        const moved = await trx
          .updateTable('match_link')
          .set({ product_id: keeper })
          .where('product_id', 'in', secondaries)
          .execute();
        counts.movedLinks += moved.reduce((acc, r) => acc + Number(r.numUpdatedRows ?? 0), 0);

        const dealRows = await trx
          .selectFrom('deal_candidate')
          .select(['id', 'detected_at'])
          .where('product_id', 'in', secondaries)
          .execute();
        const dateOf = (d: Date) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(d);
        if (dealRows.length > 0) {
          // Mover deals evitando colisión con los del keeper (unique (product_id, detected_date)).
          const keeperDates = new Set(
            (
              await trx
                .selectFrom('deal_candidate')
                .select('detected_at')
                .where('product_id', '=', keeper)
                .execute()
            ).map((d) => dateOf(d.detected_at)),
          );
          const movableIds = dealRows
            .filter((d) => !keeperDates.has(dateOf(d.detected_at)))
            .map((d) => d.id);
          if (movableIds.length > 0) {
            await trx
              .updateTable('deal_candidate')
              .set({ product_id: keeper })
              .where('id', 'in', movableIds)
              .execute();
            counts.movedDeals += movableIds.length;
          }
        }

        await trx.deleteFrom('price_aggregate').where('product_id', 'in', secondaries).execute();
        counts.removedAggregates += secondaries.length;
        await trx.deleteFrom('product').where('id', 'in', secondaries).execute();
        counts.merged += secondaries.length;
      });
    } catch (err) {
      logger.warn({ keeper, secondaries, err }, 'consolidate: grupo omitido por error');
    }
  }

  logger.info(counts, APPLY ? 'consolidate: resumen aplicado' : 'consolidate: resumen dry-run');
}

run()
  .catch((err) => {
    logger.error({ err }, 'consolidate falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
