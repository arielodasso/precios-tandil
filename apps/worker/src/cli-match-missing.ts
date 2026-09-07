/**
 * Matcheo puntual de SKUs sin vínculo (status null) o en revisión pendiente.
 *
 * Los SKUs activos de una tienda sin `match_link` (status null) nunca entraron
 * a la fase de matching, y los `pending_review` quedaron sin resolución.
 * Este CLI aplica la MISMA lógica de matching del pipeline (findBestMatch con
 * autoThreshold 0.82) sobre los productos existentes. SOLO escribe matches
 * claros (>= umbral); el resto queda intacto (sin forzar matches dudosos).
 *
 * Uso: pnpm --filter @precios/worker match-missing            # dry-run
 *      pnpm --filter @precios/worker match-missing -- --apply # escribe
 */
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { sql } from 'kysely';
import {
  normalizeDescription,
  findBestMatch,
  type MatchCandidate,
} from '@precios/normalizer';

const APPLY = process.argv.includes('--apply');
const AUTO_MATCH_THRESHOLD = 0.82;

const storeArg = process.argv.find((a) => a.startsWith('--store='));
const STORE_SLUG = storeArg ? storeArg.split('=')[1] : null;

interface ProductRow {
  id: number;
  ean: string | null;
  canonical_name: string;
  brand: string | null;
  unit_amount: string | null;
  unit_type: string | null;
  image_url: string | null;
  image_hash: string | null;
}

interface SkuRow {
  id: number;
  raw_description: string;
  description: string | null;
  declared_ean: string | null;
  store_slug: string;
  link_status: string | null;
}

function toCandidate(p: ProductRow): MatchCandidate {
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
    variantFlags: norm.variantFlags,
    imageHash: p.image_hash,
    imageUrl: p.image_url,
    contextText: '',
  };
}

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

async function main() {
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
    ])
    .execute()) as unknown as ProductRow[];

  const candidates = products.map(toCandidate);

  const rows = await sql<
    SkuRow & { store_slug: string; link_status: string | null }
  >`
    select ss.id, ss.raw_description, ss.description, ss.declared_ean,
           s.slug as store_slug, ml.status as link_status
    from store_sku ss
    join store s on s.id = ss.store_id
    left join match_link ml on ml.store_sku_id = ss.id
    where ss.is_active and s.is_active
      and (ml.status is null or ml.status = 'pending_review')
      ${STORE_SLUG ? sql`and s.slug = ${STORE_SLUG}` : sql``}
  `
    .execute(db)
    .then((r) => r.rows);

  const stats = {
    total: rows.length,
    matchEan: 0,
    matchSemantic: 0,
    noMatch: 0,
    noMatchWasNull: 0,
    noMatchWasPending: 0,
    byStore: new Map<string, number>(),
    byStoreMatch: new Map<string, number>(),
  };

  let processed = 0;
  for (const sku of rows) {
    stats.byStore.set(sku.store_slug, (stats.byStore.get(sku.store_slug) ?? 0) + 1);
    processed++;
    if (processed % 1000 === 0) {
      logger.info({ processed, total: stats.total }, 'progreso match-missing');
    }
    const norm = normalizeDescription(sku.raw_description, { description: sku.description });
    const outcome = findBestMatch(norm, sku.declared_ean ?? undefined, candidates, {
      autoThreshold: AUTO_MATCH_THRESHOLD,
    });

    if (outcome.method === 'ean' || outcome.method === 'semantic') {
      stats[outcome.method === 'ean' ? 'matchEan' : 'matchSemantic']++;
      stats.byStoreMatch.set(sku.store_slug, (stats.byStoreMatch.get(sku.store_slug) ?? 0) + 1);
      logger.info(
        {
          skuId: sku.id,
          store: sku.store_slug,
          product: outcome.productId,
          method: outcome.method,
          score: outcome.method === 'semantic' ? outcome.score : 1,
        },
        APPLY ? 'match' : 'match (dry)',
      );
      if (APPLY) {
        await db
          .insertInto('match_link')
          .values({
            store_sku_id: sku.id,
            product_id: outcome.productId,
            method: outcome.method,
            score:
              outcome.method === 'semantic' ? outcome.score.toFixed(4) : '1.0000',
            status: 'auto',
          })
          .onConflict((oc) =>
            oc.column('store_sku_id').doUpdateSet({
              product_id: outcome.productId,
              method: outcome.method,
              score:
                outcome.method === 'semantic' ? outcome.score.toFixed(4) : '1.0000',
              status: 'auto',
            }),
          )
          .execute();
      }
    } else {
      stats.noMatch++;
      if (sku.link_status === null) stats.noMatchWasNull++;
      else stats.noMatchWasPending++;
    }
  }

  logger.info(
    {
      dryRun: !APPLY,
      ...stats,
      byStore: Object.fromEntries(stats.byStore),
      byStoreMatch: Object.fromEntries(stats.byStoreMatch),
    },
    'match-missing: resumen',
  );
  await db.destroy();
}

main()
  .catch((err) => {
    logger.error({ err }, 'match-missing falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
