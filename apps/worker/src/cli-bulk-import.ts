/**
 * Importación masiva (batch) del catálogo completo de una tienda VTEX.
 *
 * El pipeline incremental (cli-ingest) hace ~5-6 round-trips a la DB por
 * producto (insert store_sku, match, resolve categoría, insert match_link,
 * select + insert price). Contra Neon, eso da ~10-20 SKUs/min, inviable para
 * catálogos de 10-15k. Este CLI reutiliza el mismo normalizador/matcher pero
 * acumula y dispara las escrituras por lotes (multi-row INSERT ... ON CONFLICT),
 * reduciendo los round-trips varios órdenes de magnitud.
 *
 * Uso:
 *   bulk-import --store carrefour
 *   bulk-import --store carrefour --limit 500   # modo test
 *   bulk-import --store carrefour --dry         # cuenta sin escribir
 */
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { sql, type Kysely } from 'kysely';
import {
  AppError,
  type DB,
  type ProductSnapshot,
  type StoreConfig,
  type StoreSlug,
} from '@precios/shared';
import {
  ResilientHttpClient,
  type AdapterContext,
  type ScraperAdapter,
} from '@precios/scraper-core';
import {
  findBestMatch,
  normalizeDescription,
  type MatchCandidate,
  type NormalizedProduct,
} from '@precios/normalizer';
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { loadAdapters } from './scheduler/registry.ts';
import { RunReporter, resolveStatus } from './pipeline/run-reporter.ts';
import {
  matchCategoryByName,
  matchCategoryByStorePath,
  normalizeToken,
} from './lib/category-map.ts';

const AUTO_MATCH_THRESHOLD = 0.82;
const FLUSH_EVERY = 300;

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
];

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

interface ProductRow {
  id: string | number;
  slug: string;
  canonical_name: string;
  brand: string | null;
  ean: string | null;
  unit_amount: string | null;
  unit_type: string | null;
  image_url: string | null;
  image_hash: string | null;
}

interface PendingProduct {
  slug: string;
  canonical_name: string;
  brand: string | null;
  ean: string | null;
  unit_amount: string | null;
  unit_type: 'kg' | 'g' | 'l' | 'ml' | 'un' | null;
  image_url: string | null;
  category_id: number | null;
}

interface PendingSku {
  store_id: number;
  external_id: string;
  url: string;
  raw_description: string;
  description: string | null;
  declared_ean: string | null;
  unit_label: string | null;
  last_seen_at: Date;
  is_active: boolean;
}

interface PendingPrice {
  store_sku_id: null;
  external_id: string;
  price_amount: string;
  currency: string;
  list_or_promo: 'list' | 'promo';
  unit_price: string | null;
  source_url: string;
  captured_at: Date;
  run_id: string;
}

interface PendingLink {
  external_id: string;
  product_id: number | null;
  product_slug: string | null;
  method: 'ean' | 'semantic';
  score: string | null;
  status: 'auto' | 'pending_review' | 'confirmed' | 'rejected';
}

function toCandidate(p: ProductRow): MatchCandidate {
  const norm = normalizeDescription(p.canonical_name, { brand: p.brand });
  return {
    productId: Number(p.id),
    ean: p.ean,
    normName: norm.normName,
    unitAmount: norm.unitAmount,
    unitType: norm.unitType,
    brand: p.brand,
    brandProvided: norm.brandProvided,
    typeKeys: norm.typeKeys,
    variantFlags: norm.variantFlags,
    imageHash: p.image_hash,
    imageUrl: p.image_url,
    contextText: '',
  };
}

function forgeSlug(norm: NormalizedProduct, snap: ProductSnapshot): string {
  const slugBase = norm.normName.replace(/\s+/g, '-').slice(0, 60) || 'producto';
  const hash = createHash('sha1')
    .update(snap.ean ?? norm.normName)
    .digest('base64url')
    .slice(0, 6);
  return `${slugBase}-${hash}`;
}

async function flush(
  db: Kysely<DB>,
  options: {
    dry: boolean;
    pendingProducts: PendingProduct[];
    pendingSkus: PendingSku[];
    pendingPrices: PendingPrice[];
    pendingLinks: PendingLink[];
    slugToId: Map<string, number>;
    candidates: MatchCandidate[];
    pendingCandidates: Array<{ slug: string; cand: MatchCandidate }>;
    eanIndex: Map<string, number[]>;
  },
): Promise<void> {
  const {
    dry,
    pendingProducts,
    pendingSkus,
    pendingPrices,
    pendingLinks,
    slugToId,
    candidates,
    pendingCandidates,
    eanIndex,
  } = options;

  // ---- Productos nuevos ----
  if (!dry && pendingProducts.length > 0) {
    const ins = await db
      .insertInto('product')
      .values(pendingProducts)
      .onConflict((oc) => oc.column('slug').doUpdateSet({ updated_at: new Date() }))
      .returning(['id', 'slug'])
      .execute();
    for (const r of ins) slugToId.set(r.slug, Number(r.id));
    for (const pc of pendingCandidates) {
      const id = slugToId.get(pc.slug);
      if (id !== undefined && id > 0) {
        candidates.push({ ...pc.cand, productId: id });
        if (pc.cand.ean && /^\d{13}$/.test(pc.cand.ean)) {
          const arr = eanIndex.get(pc.cand.ean) ?? [];
          arr.push(id);
          eanIndex.set(pc.cand.ean, arr);
        }
      }
    }
    pendingCandidates.length = 0;
    pendingProducts.length = 0;
  }

  // ---- store_sku + match_link + price_record ----
  // Postgres no admite claves de conflicto duplicadas dentro de un mismo
  // INSERT ... ON CONFLICT DO UPDATE (error 21000). Un mismo external_id puede
  // repetirse en el lote (el mismo SKU listado en varias categorías): nos
  // quedamos con la primera aparición y descartamos link/price duplicados.
  if (!dry && pendingSkus.length > 0) {
    {
      const seen = new Set<string>();
      const keep: number[] = [];
      for (let i = 0; i < pendingSkus.length; i++) {
        const ext = (pendingSkus[i] as { external_id: string }).external_id;
        if (!seen.has(ext)) {
          seen.add(ext);
          keep.push(i);
        }
      }
      const keepSet = new Set(keep);
      pendingSkus.splice(
        0,
        pendingSkus.length,
        ...pendingSkus.filter((_x: unknown, i: number) => keepSet.has(i)),
      );
      pendingLinks.splice(
        0,
        pendingLinks.length,
        ...pendingLinks.filter((_x: unknown, i: number) => keepSet.has(i)),
      );
      pendingPrices.splice(
        0,
        pendingPrices.length,
        ...pendingPrices.filter((_x: unknown, i: number) => keepSet.has(i)),
      );
    }

    const ins = await db
      .insertInto('store_sku')
      .values(pendingSkus)
      .onConflict((oc) =>
        oc.columns(['store_id', 'external_id']).doUpdateSet({
          url: sql.ref('excluded.url'),
          raw_description: sql.ref('excluded.raw_description'),
          description: sql.ref('excluded.description'),
          declared_ean: sql.ref('excluded.declared_ean'),
          unit_label: sql.ref('excluded.unit_label'),
          last_seen_at: new Date(),
          is_active: true,
        }),
      )
      .returning(['id', 'external_id'])
      .execute();
    const extToSkuId = new Map(ins.map((r) => [r.external_id, Number(r.id)]));
    pendingSkus.length = 0;

    const links = pendingLinks
      .map((l) => {
        const skuId = extToSkuId.get(l.external_id);
        if (skuId === undefined) return null;
        const productId: number | undefined =
          l.product_id ?? (l.product_slug ? slugToId.get(l.product_slug) : undefined);
        if (productId === undefined) return null;
        return {
          store_sku_id: skuId,
          product_id: productId,
          method: l.method,
          score: l.score,
          status: l.status,
        };
      })
      .filter((x) => x !== null);
    if (links.length > 0) {
      await db
        .insertInto('match_link')
        .values(links)
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
    pendingLinks.length = 0;

    const prices = pendingPrices
      .map((p) => {
        const skuId = extToSkuId.get(p.external_id);
        if (skuId === undefined) return null;
        return {
          store_sku_id: skuId,
          price_amount: p.price_amount,
          currency: p.currency,
          list_or_promo: p.list_or_promo,
          unit_price: p.unit_price,
          source_url: p.source_url,
          captured_at: p.captured_at,
          run_id: p.run_id,
          is_suspect: false,
        };
      })
      .filter((x) => x !== null);
    if (prices.length > 0) {
      await db
        .insertInto('price_record')
        .values(prices)
        .onConflict((oc) =>
          oc.columns(['store_sku_id', 'captured_at', 'list_or_promo']).doNothing(),
        )
        .execute();
    }
    pendingPrices.length = 0;
  } else {
    pendingLinks.length = 0;
    pendingPrices.length = 0;
    pendingCandidates.length = 0;
    pendingProducts.length = 0;
    pendingSkus.length = 0;
  }
}

async function main(slug: string): Promise<void> {
  const config = loadConfig();
  const dry = hasFlag('--dry');
  const limitRaw = argValue('--limit');
  const limit = limitRaw ? Number(limitRaw) : Infinity;

  const db = createDb(config.DATABASE_URL);
  const adapters = await loadAdapters({ warn: (msg, err) => logger.warn({ err }, msg) });
  const adapter = adapters.get(slug as StoreSlug) as ScraperAdapter | undefined;
  if (!adapter) {
    logger.error('Sin adaptador para ' + slug);
    process.exit(1);
  }

  const store = await db
    .selectFrom('store')
    .select(['id', 'base_url', 'config'])
    .where('slug', '=', slug as StoreSlug)
    .where('is_active', '=', true)
    .limit(1)
    .executeTakeFirst();
  if (!store) {
    logger.error('Tienda inactiva o inexistente: ' + slug);
    process.exit(1);
  }
  const storeId = Number(store.id);
  const storeConfig = (store.config as unknown as StoreConfig) ?? {};

  const runId = randomUUID();
  const reporter = new RunReporter(db, logger, {
    runId,
    correlationId: `bulk-${Date.now()}`,
    storeId,
  });
  if (!dry) await reporter.start();

  // ---- Taxonomía en memoria ----
  const cats = await db.selectFrom('category').select(['id', 'path']).execute();
  const pathToCatId = new Map<string, number>(cats.map((c) => [c.path, Number(c.id)]));
  const resolveCategory = (categoryPath: string[] | undefined, name?: string): number | null => {
    let taxPath = matchCategoryByStorePath(categoryPath);
    if (!taxPath && name) taxPath = matchCategoryByName(name);
    if (taxPath && pathToCatId.has(taxPath)) return pathToCatId.get(taxPath)!;
    if (!categoryPath || categoryPath.length === 0) return null;
    const fullPath = categoryPath.map(normalizeToken).filter(Boolean).join('/');
    if (pathToCatId.has(fullPath)) return pathToCatId.get(fullPath)!;
    const root = normalizeToken(categoryPath[0]!);
    return pathToCatId.get(root) ?? null;
  };

  // ---- Productos existentes / candidatos ----
  const prods = (await db
    .selectFrom('product')
    .select([
      'id',
      'slug',
      'canonical_name',
      'brand',
      'ean',
      'unit_amount',
      'unit_type',
      'image_url',
      'image_hash',
    ])
    .execute()) as unknown as ProductRow[];

  const slugToId = new Map<string, number>();
  const candidates: MatchCandidate[] = [];
  const eanIndex = new Map<string, number[]>();
  const isValidEan = (ean: string): boolean => /^\d{13}$/.test(ean);
  for (const p of prods) {
    const id = Number(p.id);
    slugToId.set(p.slug, id);
    candidates.push(toCandidate(p));
    if (p.ean && isValidEan(p.ean)) {
      const arr = eanIndex.get(p.ean) ?? [];
      arr.push(id);
      eanIndex.set(p.ean, arr);
    }
  }
  logger.info({ products: prods.length, categories: cats.length }, 'bulk-import: inicio');

  // ---- Browser + http ----
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'es-AR' });
  const http = new ResilientHttpClient({
    userAgents: UA_POOL,
    maxConcurrent: storeConfig.maxConcurrent ?? 4,
    minDelayMs: storeConfig.delayMs?.[0] ?? 200,
    maxDelayMs: storeConfig.delayMs?.[1] ?? 400,
    logger,
  });
  const ctx: AdapterContext = {
    runId,
    logger,
    http,
    browser: context,
    signal: AbortSignal.timeout(3 * 3_600_000),
    storeConfig,
  };

  // ---- Acumuladores (mutable) ----
  const pendingProducts: PendingProduct[] = [];
  const pendingCandidates: Array<{ slug: string; cand: MatchCandidate }> = [];
  const pendingSkus: PendingSku[] = [];
  const pendingPrices: PendingPrice[] = [];
  const pendingLinks: PendingLink[] = [];
  const createdSlugs = new Set<string>();

  let processed = 0;
  let captured = 0;
  let created = 0;
  let matched = 0;
  const touchedProductIds = new Set<number>();

  async function doFlush(): Promise<void> {
    await flush(db, {
      dry,
      pendingProducts,
      pendingSkus,
      pendingPrices,
      pendingLinks,
      slugToId,
      candidates,
      pendingCandidates,
      eanIndex,
    });
  }

  let last = Date.now();
  try {
    for await (const snap of adapter.scrapeCatalog(ctx)) {
      if (processed >= limit) break;
      processed++;
      if (!(snap.price.amount >= 500)) {
        reporter.countRejected('below_min_price', snap.externalId);
        continue;
      }
      reporter.countCaptured();
      const norm = normalizeDescription(snap.rawDescription, {
        brand: snap.brand,
        description: snap.description,
      });

      let productId: number | null = null;
      let productSlug: string | null = null;
      let method: 'ean' | 'semantic' = 'semantic';
      let score: string | null = null;
      const status = 'auto';

      const ean = snap.ean && /^\d{13}$/.test(snap.ean) ? snap.ean : undefined;
      let matchedProductId: number | null = null;

      if (ean) {
        const hits = eanIndex.get(ean) ?? [];
        if (hits.length === 1) {
          matchedProductId = hits[0]!;
          method = 'ean';
          score = '1';
        } else if (hits.length > 1) {
          const subset = hits
            .map((id) => candidates.find((c) => c.productId === id))
            .filter((c): c is MatchCandidate => Boolean(c));
          const subOutcome = findBestMatch(norm, ean, subset, {
            autoThreshold: AUTO_MATCH_THRESHOLD,
          });
          if (subOutcome.method !== 'none') {
            matchedProductId = subOutcome.productId;
            method = 'ean';
            score = '1';
          }
        }
      } else {
        const outcome = findBestMatch(norm, undefined, candidates, {
          autoThreshold: AUTO_MATCH_THRESHOLD,
        });
        if (outcome.method !== 'none') {
          matchedProductId = outcome.productId;
          method = 'semantic';
          score = outcome.score.toFixed(4);
        }
      }

      if (matchedProductId !== null) {
        productId = matchedProductId;
        matched++;
        touchedProductIds.add(matchedProductId);
      } else {
        const catId = resolveCategory(snap.categoryPath, norm.normName);
        const slug = forgeSlug(norm, snap);
        if (slugToId.has(slug)) {
          productId = slugToId.get(slug)!;
          touchedProductIds.add(productId);
        } else if (!createdSlugs.has(slug)) {
          createdSlugs.add(slug);
          pendingProducts.push({
            slug,
            canonical_name: norm.normName,
            brand: norm.brand ?? snap.brand ?? null,
            ean: snap.ean ?? null,
            unit_amount: norm.unitAmount !== null ? String(norm.unitAmount) : null,
            unit_type: norm.unitType,
            image_url: snap.imageUrl ?? null,
            category_id: catId,
          });
          pendingCandidates.push({
            slug,
            cand: {
              productId: -1,
              ean: snap.ean ?? null,
              normName: norm.normName,
              unitAmount: norm.unitAmount,
              unitType: norm.unitType,
              brand: norm.brand ?? snap.brand ?? null,
              brandProvided: norm.brandProvided,
              typeKeys: norm.typeKeys,
              variantFlags: norm.variantFlags,
              imageHash: null,
              imageUrl: snap.imageUrl ?? null,
              contextText: '',
            },
          });
          created++;
          productSlug = slug;
        } else {
          // ya encolado en este lote: coincide por slug (dedup dentro del run)
          productSlug = slug;
        }
      }

      pendingSkus.push({
        store_id: storeId,
        external_id: snap.externalId,
        url: snap.url,
        raw_description: snap.rawDescription,
        description: snap.description ?? null,
        declared_ean: snap.ean ?? null,
        unit_label: snap.unitLabel ?? null,
        last_seen_at: new Date(),
        is_active: true,
      });
      pendingLinks.push({
        external_id: snap.externalId,
        product_id: productId,
        product_slug: productSlug,
        method,
        score,
        status,
      });
      pendingPrices.push({
        store_sku_id: null,
        external_id: snap.externalId,
        price_amount: snap.price.amount.toFixed(2),
        currency: 'ARS',
        list_or_promo: snap.price.listOrPromo,
        unit_price: snap.price.unitPrice !== undefined ? snap.price.unitPrice.toFixed(3) : null,
        source_url: snap.url,
        captured_at: new Date(snap.capturedAt),
        run_id: runId,
      });
      captured++;

      if (pendingSkus.length >= FLUSH_EVERY) {
        await doFlush();
        const now = Date.now();
        const elapsed = (now - last) / 1000;
        if (elapsed >= 15) {
          logger.info(
            {
              processed,
              created,
              matched,
              ratePerMin: Math.round((processed / elapsed) * 60),
            },
            'bulk-import: progreso',
          );
          last = now;
        }
      }
    }
    await doFlush();
  } catch (err) {
    if (err instanceof AppError && err.code === 'adapter_missing') {
      logger.warn({ store: slug }, 'adaptador no implementado');
    } else {
      logger.error({ err }, 'bulk-import: error');
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  // ---- Actualizar categoría de los productos tocados (asignada al crear /
  // conservada para los existentes; el backfill posterior ajusta el resto) ----
  logger.info(
    { touchedProducts: touchedProductIds.size },
    'bulk-import: categorías asignadas al crear los productos nuevos',
  );

  const status = resolveStatus({
    captured,
    rejected: 0,
    httpErrors: 0,
    iteratorFailed: false,
  });
  if (!dry) await reporter.finish(status);

  logger.info(
    { runId, status, processed, captured, created, matched, dry },
    'bulk-import: resumen',
  );
  await db.destroy();
}

const slug = argValue('--store');
if (!slug) {
  console.error('Uso: bulk-import --store <slug> [--limit N] [--dry]');
  process.exit(1);
}
main(slug).catch((err) => {
  logger.error({ err }, 'bulk-import falló');
  process.exit(1);
});
