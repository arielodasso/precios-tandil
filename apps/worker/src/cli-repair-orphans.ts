/**
 * Reparación histórica de store_sku huérfanos.
 *
 * Recupera matches por EAN normalizado, matching semántico y crea productos nuevos.
 *
 * Uso:
 *   pnpm --filter @precios/worker repair-orphans           # dry-run (reporta)
 *   pnpm --filter @precios/worker repair-orphans --apply   # ejecuta los cambios
 *   pnpm --filter @precios/worker repair-orphans --store=vea --batch=500
 *   pnpm --filter @precios/worker repair-orphans --limit=1000
 */
import { createHash } from 'node:crypto';
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { sql } from 'kysely';
import {
  diceSimilarity,
  normalizeDescription,
  findBestMatch,
  presentationConflict,
  type MatchCandidate,
  type NormalizedProduct,
} from '@precios/normalizer';
import { matchCategoryByName } from './lib/category-map.ts';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = parseInt(
  process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] || '500',
  10,
);
const LIMIT = parseInt(
  process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0',
  10,
);
const storeArg = process.argv.find((a) => a.startsWith('--store='));
const STORE_SLUG = storeArg ? storeArg.split('=')[1] : null;

const AUTO_MATCH_THRESHOLD = 0.82;
const REVIEW_THRESHOLD = 0.65;
const EAN_CONFLICT_SIMILARITY = 0.75;

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

interface ProductRow {
  id: number;
  slug: string;
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
  store_id: number;
  external_id: string;
  raw_description: string;
  description: string | null;
  declared_ean: string | null;
}

function normalizeEan(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  if (!/^\d{8,}$/.test(s)) return null;
  return s.padStart(13, '0');
}

function isValidEan13(ean: string | null): boolean {
  if (!ean || !/^\d{13}$/.test(ean)) return false;
  const digits = [...ean].map((d) => Number(d));
  const checksum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (checksum % 10)) % 10 === digits[12]!;
}

function toCandidate(p: ProductRow): MatchCandidate {
  const norm = normalizeDescription(p.canonical_name, { brand: p.brand });
  return {
    productId: p.id,
    ean: p.ean,
    normName: norm.normName,
    unitAmount: p.unit_amount !== null ? Number(p.unit_amount) : null,
    unitType: p.unit_type,
    unitCount: norm.unitCount,
    isPack: norm.isPack,
    brand: p.brand,
    brandProvided: norm.brandProvided,
    typeKeys: norm.typeKeys,
    variantFlags: norm.variantFlags,
    imageHash: p.image_hash,
    imageUrl: p.image_url,
    contextText: '',
  };
}

function forgeSlug(norm: NormalizedProduct, ean: string | null, name: string): string {
  const slugBase = norm.normName.replace(/\s+/g, '-').slice(0, 60) || 'producto';
  const hash = createHash('sha1')
    .update(ean ?? name)
    .digest('base64url')
    .slice(0, 6);
  return `${slugBase}-${hash}`;
}

async function main() {
  logger.info(
    { dryRun: !APPLY, store: STORE_SLUG, batchSize: BATCH_SIZE, limit: LIMIT },
    'repair-orphans: inicio',
  );

  // 1. Cargar productos existentes como candidatos
  logger.info('Cargando productos como candidatos...');
  const products = (await db
    .selectFrom('product')
    .select([
      'id',
      'slug',
      'ean',
      'canonical_name',
      'brand',
      'unit_amount',
      'unit_type',
      'image_url',
      'image_hash',
    ])
    .execute()) as unknown as ProductRow[];

  const candidates: MatchCandidate[] = products.map(toCandidate);
  const slugToId = new Map<string, number>(products.map((p) => [p.slug, Number(p.id)]));
  const eanToProducts = new Map<string, ProductRow[]>();

  for (const p of products) {
    if (p.ean) {
      const list = eanToProducts.get(p.ean) ?? [];
      list.push(p);
      eanToProducts.set(p.ean, list);
    }
  }

  logger.info(
    { products: products.length, candidates: candidates.length, eanGroups: eanToProducts.size },
    'Candidatos cargados',
  );

  // 2. Obtener SKUs huérfanos con price_records
  const storeFilter = STORE_SLUG ? sql`AND s.slug = ${STORE_SLUG}` : sql``;
  const limitClause = LIMIT > 0 ? sql`LIMIT ${LIMIT}` : sql``;

  const orphanSkus = (
    await sql<SkuRow & { store_slug: string; price_count: number }>`
    SELECT 
      ss.id,
      ss.store_id,
      s.slug as store_slug,
      ss.external_id,
      ss.raw_description,
      ss.description,
      ss.declared_ean,
      COUNT(pr.id) as price_count
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ss.is_active = true
      AND ml.id IS NULL
      ${storeFilter}
    GROUP BY ss.id, ss.store_id, s.slug, ss.external_id, ss.raw_description, ss.description, ss.declared_ean
    HAVING COUNT(pr.id) > 0
    ORDER BY price_count DESC
    ${limitClause}
  `.execute(db)
  ).rows;

  logger.info({ totalOrphans: orphanSkus.length }, 'SKUs huérfanos con precios encontrados');

  // 3. Estadísticas
  const stats = {
    total: orphanSkus.length,
    matchedEan: 0,
    matchedSemantic: 0,
    pendingReview: 0,
    newProduct: 0,
    noMatch: 0,
    createdProducts: 0,
    errors: 0,
  };

  const pendingProducts: Array<{
    slug: string;
    canonical_name: string;
    brand: string | null;
    ean: string | null;
    unit_amount: string | null;
    unit_type: 'kg' | 'g' | 'l' | 'ml' | 'un' | null;
    image_url: string | null;
    category_id: number | null;
  }> = [];

  const pendingLinks: Array<{
    store_sku_id: number;
    product_id: number | null;
    product_slug: string | null;
    method: 'ean' | 'semantic';
    score: string;
    status: 'auto' | 'pending_review';
  }> = [];

  // 4. Categorías para nuevos productos
  const categoryRows = await db.selectFrom('category').select(['id', 'path']).execute();
  const pathToCatId = new Map<string, number>(categoryRows.map((c) => [c.path, Number(c.id)]));
  const categoryIdFor = (name: string): number | null => {
    const path = matchCategoryByName(name);
    return path ? (pathToCatId.get(path) ?? null) : null;
  };

  async function flushPendingProducts() {
    if (!APPLY || pendingProducts.length === 0) return;

    const unique = new Map<string, (typeof pendingProducts)[number]>();
    for (const p of pendingProducts) {
      if (!unique.has(p.slug)) unique.set(p.slug, p);
    }

    const ins = await db
      .insertInto('product')
      .values([...unique.values()])
      .onConflict((oc) => oc.column('slug').doUpdateSet({ updated_at: new Date() }))
      .returning(['id', 'slug'])
      .execute();

    for (const r of ins) {
      const id = Number(r.id);
      slugToId.set(r.slug, id);
      const prod = unique.get(r.slug);
      if (prod && id > 0) {
        for (const link of pendingLinks) {
          if (link.product_slug === r.slug) link.product_id = id;
        }
        const norm = normalizeDescription(prod.canonical_name, { brand: prod.brand });
        candidates.push({
          productId: id,
          ean: prod.ean,
          normName: norm.normName,
          unitAmount: prod.unit_amount !== null ? Number(prod.unit_amount) : null,
          unitType: prod.unit_type,
          unitCount: norm.unitCount,
          isPack: norm.isPack,
          brand: prod.brand,
          brandProvided: norm.brandProvided,
          typeKeys: norm.typeKeys,
          variantFlags: norm.variantFlags,
          imageHash: null,
          imageUrl: prod.image_url,
          contextText: '',
        });
      }
    }
    stats.createdProducts += ins.length;
    pendingProducts.length = 0;
  }

  async function flushLinks() {
    if (!APPLY) return;

    const ready = pendingLinks
      .filter((l) => l.product_id !== null && l.product_id !== undefined)
      .map((l) => ({
        store_sku_id: l.store_sku_id,
        product_id: l.product_id!,
        method: l.method,
        score: l.score,
        status: l.status,
      }));

    pendingLinks.length = 0;

    if (ready.length > 0) {
      await db
        .insertInto('match_link')
        .values(ready)
        .onConflict((oc) =>
          oc.column('store_sku_id').doUpdateSet({
            product_id: sql.ref('excluded.product_id'),
            method: sql.ref('excluded.method'),
            score: sql.ref('excluded.score'),
            status: sql.ref('excluded.status'),
          }),
        )
        .execute();
    }
  }

  // 5. Procesar cada SKU huérfano
  for (let i = 0; i < orphanSkus.length; i++) {
    const sku = orphanSkus[i]!;
    const norm = normalizeDescription(sku.raw_description, { description: sku.description });
    const normalizedEan = normalizeEan(sku.declared_ean);

    let productId: number | null = null;
    let productSlug: string | null = null;
    let method: 'ean' | 'semantic' = 'semantic';
    let score: string | null = null;
    let linkStatus: 'auto' | 'pending_review' = 'auto';

    // A) Intentar match por EAN normalizado
    if (normalizedEan) {
      const eanProducts = eanToProducts.get(normalizedEan) ?? [];
      if (eanProducts.length === 1) {
        const cand = eanProducts[0]!;
        const matchedCand = candidates.find((c) => c.productId === cand.id);
        if (matchedCand) {
          const sim = diceSimilarity(norm.normName, matchedCand.normName);
          if (sim >= EAN_CONFLICT_SIMILARITY && !presentationConflict(norm, matchedCand)) {
            productId = cand.id;
            method = 'ean';
            score = '1';
            stats.matchedEan++;
          } else {
            linkStatus = 'pending_review';
            logger.warn(
              { skuId: sku.id, ean: normalizedEan, productId: cand.id, sim },
              'EAN match con conflicto semántico/presentación',
            );
            stats.pendingReview++;
          }
        }
      } else if (eanProducts.length > 1) {
        // Múltiples productos con mismo EAN - elegir el más similar semánticamente
        let best: MatchCandidate | null = null;
        let bestScore = -1;
        for (const p of eanProducts) {
          const cand = candidates.find((c) => c.productId === p.id);
          if (cand) {
            const s = diceSimilarity(norm.normName, cand.normName);
            if (s > bestScore) {
              bestScore = s;
              best = cand;
            }
          }
        }
        if (best && bestScore >= EAN_CONFLICT_SIMILARITY && !presentationConflict(norm, best)) {
          productId = best.productId;
          method = 'ean';
          score = '1';
          stats.matchedEan++;
        } else if (best) {
          linkStatus = 'pending_review';
          stats.pendingReview++;
        }
      }
    }

    // B) Match semántico si no hubo EAN match
    if (productId === null) {
      const outcome = findBestMatch(norm, normalizedEan ?? undefined, candidates, {
        autoThreshold: AUTO_MATCH_THRESHOLD,
      });

      if (outcome.method === 'ean') {
        productId = outcome.productId;
        method = 'ean';
        score = '1';
        stats.matchedEan++;
      } else if (outcome.method === 'semantic') {
        productId = outcome.productId;
        method = 'semantic';
        score = outcome.score.toFixed(4);
        stats.matchedSemantic++;
      } else if (outcome.bestCandidateId !== null && outcome.bestScore >= REVIEW_THRESHOLD) {
        productId = outcome.bestCandidateId;
        method = 'semantic';
        score = outcome.bestScore.toFixed(4);
        linkStatus = 'pending_review';
        stats.pendingReview++;
      }
    }

    // C) Crear producto nuevo si no hay match
    if (productId === null && productSlug === null) {
      const realEan = normalizedEan && isValidEan13(normalizedEan) ? normalizedEan : null;
      const slug = forgeSlug(norm, realEan, sku.raw_description);
      const existingId = slugToId.get(slug);

      if (existingId !== undefined) {
        productId = existingId;
        method = 'semantic';
        score = '0.82';
      } else {
        const catId = categoryIdFor(norm.normName);
        pendingProducts.push({
          slug,
          canonical_name: norm.normName,
          brand: norm.brand ?? null,
          ean: realEan,
          unit_amount: norm.unitAmount !== null ? String(norm.unitAmount) : null,
          unit_type: norm.unitType,
          image_url: null,
          category_id: catId,
        });
        productSlug = slug;
        stats.newProduct++;
      }
    }

    // Registrar link pendiente
    if (productId !== null) {
      pendingLinks.push({
        store_sku_id: sku.id,
        product_id: productId,
        product_slug: null,
        method,
        score: score ?? '0',
        status: linkStatus,
      });
    } else if (productSlug) {
      pendingLinks.push({
        store_sku_id: sku.id,
        product_id: null,
        product_slug: productSlug,
        method,
        score: score ?? '0.82',
        status: linkStatus,
      });
    } else {
      stats.noMatch++;
    }

    // Flush cada batch
    if ((i + 1) % BATCH_SIZE === 0 || i === orphanSkus.length - 1) {
      logger.info({ processed: i + 1, ...stats }, 'repair-orphans: progreso');
      await flushPendingProducts();
      await flushLinks();
    }
  }

  // Final flush
  await flushPendingProducts();
  await flushLinks();

  logger.info({ dryRun: !APPLY, ...stats }, 'repair-orphans: resumen final');
  await db.destroy();
}

main()
  .catch((err) => {
    logger.error({ err }, 'repair-orphans falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
