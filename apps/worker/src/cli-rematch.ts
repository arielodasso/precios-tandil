/**
 * Re-evaluación de los vínculos de emparejamiento existentes con el matcher actual.
 *
 * El pipeline re-matchea cada snapshot nuevo en su ingesta, pero los vínculos
 * `auto`/`confirmed` ya persistidos NO se vuelven a evaluar cuando mejoramos el
 * matcher (p.ej. el bloqueo por variantes "Max" vs "Fresh"). Este CLI:
 *
 *  1. Reconstruye los candidatos (productos) con el normalizador actual.
 *  2. Para cada vínculo auto/confirmed, normaliza su SKU y recalcula el mejor match.
 *  3. Si el vínculo actual tiene un CONFLICTO DURO (variante distinta sin
 *     compartir línea, p.ej. "Max" vs "Fresh", o presentación pack vs suelta,
 *     p.ej. six-pack vs lata), lo corrige:
 *       - si existe un mejor candidato con score >= umbral, lo reasigna;
 *       - si no, lo deja en `pending_review` para revisión manual.
 *
 * Uso:
 *   pnpm --filter @precios/worker rematch            # dry-run (reporta)
 *   pnpm --filter @precios/worker rematch --apply    # ejecuta los cambios
 */
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import {
  aggregatePackInfo,
  normalizeDescription,
  semanticScore,
  findBestMatch,
  exclusiveVariantFlags,
  presentationConflict,
  type MatchCandidate,
  type NormalizedProduct,
  type PackInfo,
} from '@precios/normalizer';

const APPLY = process.argv.includes('--apply');

interface ProductRow {
  id: number;
  ean: string | null;
  canonical_name: string;
  brand: string | null;
  unit_amount: string | null;
  unit_type: string | null;
  image_url: string | null;
  image_hash: string | null;
  updated_at: Date;
  created_at: Date;
}

interface SkuRow {
  id: number;
  raw_description: string;
  description: string | null;
  declared_ean: string | null;
}

interface LinkRow {
  id: number;
  product_id: number;
  status: 'auto' | 'confirmed';
  method: string | null;
  sku: SkuRow;
}

function toCandidate(p: ProductRow, pack: PackInfo): MatchCandidate {
  const norm = normalizeDescription(p.canonical_name, { brand: p.brand });
  return {
    productId: p.id,
    ean: p.ean,
    normName: norm.normName,
    unitAmount: p.unit_amount !== null ? Number(p.unit_amount) : null,
    unitType: p.unit_type,
    unitCount: pack.count,
    isPack: pack.isPack,
    brand: p.brand,
    brandProvided: norm.brandProvided,
    typeKeys: norm.typeKeys,
    variantFlags: norm.variantFlags,
    imageHash: p.image_hash,
    imageUrl: p.image_url,
    contextText: '',
  };
}

interface ProductSkuName {
  product_id: number | string;
  raw_description: string | null;
}

/** Presentación agregada (pack/unidades) por producto desde nombres de SKUs. */
async function loadProductPackInfos(ids: number[]): Promise<Map<number, PackInfo>> {
  if (ids.length === 0) return new Map();
  const rows: ProductSkuName[] = (await db
    .selectFrom('store_sku')
    .innerJoin('match_link', 'match_link.store_sku_id', 'store_sku.id')
    .select(['store_sku.raw_description', 'match_link.product_id'])
    .where('match_link.status', '<>', 'rejected')
    .where('match_link.product_id', 'in', ids)
    .execute()) as unknown as ProductSkuName[];
  const names = new Map<number, string[]>();
  for (const row of rows) {
    const pid = Number(row.product_id);
    const arr = names.get(pid);
    if (arr) arr.push(row.raw_description ?? '');
    else names.set(pid, [row.raw_description ?? '']);
  }
  const map = new Map<number, PackInfo>();
  for (const [pid, list] of names) map.set(pid, aggregatePackInfo(list));
  return map;
}

/* ¿Ambos lados declaran variantes de línea exclusivas y NO comparten ninguna? */
function hasVariantConflict(norm: NormalizedProduct, cand: MatchCandidate): boolean {
  const nf = exclusiveVariantFlags(norm.variantFlags ?? []);
  const cf = exclusiveVariantFlags(cand.variantFlags ?? []);
  if (nf.length === 0 || cf.length === 0) return false;
  return !nf.some((f) => cf.includes(f));
}

/**
 * ¿El SKU y el producto actual no pueden ser el mismo artículo por criterios
 * duros (variante de línea distinta, o presentación pack vs suelta)?
 */
function hasUnfixableConflict(norm: NormalizedProduct, cand: MatchCandidate): boolean {
  return hasVariantConflict(norm, cand) || presentationConflict(norm, cand);
}

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

const counts = {
  links: 0,
  conflict: 0,
  reassigned: 0,
  toReview: 0,
  unchanged: 0,
  errors: 0,
};

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
      'image_url',
      'image_hash',
      'updated_at',
      'created_at',
    ])
    .execute()) as unknown as ProductRow[];

  const packInfos = await loadProductPackInfos(products.map((p) => Number(p.id)));

  const candidates = new Map<string, MatchCandidate>();
  for (const p of products) {
    candidates.set(
      String(p.id),
      toCandidate(
        p,
        packInfos.get(Number(p.id)) ?? { count: null, declared: false, isPack: false },
      ),
    );
  }
  const candidateArray = [...candidates.values()];

  const links = (await db
    .selectFrom('match_link')
    .innerJoin('store_sku', 'store_sku.id', 'match_link.store_sku_id')
    .select([
      'match_link.id',
      'match_link.product_id',
      'match_link.status',
      'match_link.method',
      'store_sku.id as sku_id',
      'store_sku.raw_description',
      'store_sku.description',
      'store_sku.declared_ean',
    ])
    .where('match_link.status', 'in', ['auto', 'confirmed'])
    .execute()) as unknown as Array<
    LinkRow & {
      sku_id: number;
      raw_description: string;
      description: string | null;
      declared_ean: string | null;
    }
  >;

  counts.links = links.length;
  logger.info(
    { dryRun: !APPLY, products: products.length, links: links.length },
    'rematch: inicio',
  );

  for (const link of links) {
    const current = candidates.get(String(link.product_id));
    if (!current) {
      counts.errors++;
      continue;
    }
    const norm = normalizeDescription(link.raw_description, {
      description: link.description,
    });
    const curScore = semanticScore(norm, current);
    const conflict = hasUnfixableConflict(norm, current);

    if (!conflict) {
      counts.unchanged++;
      continue;
    }
    counts.conflict++;

    // El vínculo actual tiene un conflicto de variante o presentación:
    const outcome = findBestMatch(norm, link.declared_ean ?? undefined, candidateArray);

    if (outcome.method === 'none') {
      // Sin mejor candidato claro: dejar en revisión para no romper datos.
      counts.toReview++;
      logger.info(
        {
          linkId: link.id,
          skuDesc: link.raw_description.slice(0, 70),
          from: link.product_id,
          curScore: curScore,
        },
        APPLY ? 'rematch: marcando para revisión' : 'rematch: would-mark-for-review',
      );
      if (APPLY) {
        await db
          .updateTable('match_link')
          .set({ status: 'pending_review', decided_by: 'rematch-cli', decided_at: new Date() })
          .where('id', '=', link.id)
          .execute();
      }
      continue;
    }

    if (outcome.productId !== link.product_id) {
      counts.reassigned++;
      logger.info(
        {
          linkId: link.id,
          skuDesc: link.raw_description.slice(0, 70),
          from: link.product_id,
          to: outcome.productId,
          score: outcome.score,
        },
        APPLY ? 'rematch: reasignando' : 'rematch: would-reassign',
      );
      if (APPLY) {
        await db
          .updateTable('match_link')
          .set({
            product_id: outcome.productId,
            method: outcome.method,
            status: 'auto',
            decided_by: 'rematch-cli',
            decided_at: new Date(),
          })
          .where('id', '=', link.id)
          .execute();
      }
      continue;
    }

    // El mejor candidato es el mismo producto, pero la variante no coincide:
    // no se puede reparar solo; dejarlo en revisión.
    counts.toReview++;
    logger.info(
      {
        linkId: link.id,
        skuDesc: link.raw_description.slice(0, 70),
        from: link.product_id,
        curScore: curScore,
      },
      APPLY ? 'rematch: marcando para revisión' : 'rematch: would-mark-for-review',
    );
    if (APPLY) {
      await db
        .updateTable('match_link')
        .set({ status: 'pending_review', decided_by: 'rematch-cli', decided_at: new Date() })
        .where('id', '=', link.id)
        .execute();
    }
  }

  logger.info(counts, APPLY ? 'rematch: resumen aplicado' : 'rematch: resumen dry-run');
}

run()
  .catch((err) => {
    logger.error({ err }, 'rematch falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
