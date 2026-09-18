import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { BrowserContext } from 'playwright';
import {
  AppError,
  pctChange,
  type DB,
  type ProductSnapshot,
  type RunStatus,
  type StoreConfig,
  type StoreSlug,
} from '@precios/shared';
import {
  ResilientHttpClient,
  validateSnapshot,
  type AdapterContext,
  type ScraperAdapter,
} from '@precios/scraper-core';
import {
  aggregatePackInfo,
  diceSimilarity,
  findBestMatch,
  normalizeDescription,
  presentationConflict,
  type MatchCandidate,
  type PackInfo,
} from '@precios/normalizer';
import { RunReporter, resolveStatus } from './run-reporter.ts';
import {
  matchCategoryByName,
  matchCategoryByStorePath,
  normalizeToken,
} from '../lib/category-map.ts';
import { computeImageHash } from '../lib/image-hash.ts';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
];

const AUTO_MATCH_THRESHOLD = 0.82;
const REVIEW_THRESHOLD = 0.65;
const EAN_CONFLICT_SIMILARITY = 0.75;
const CANDIDATE_POOL_SIZE = 100000;
const FLUSH_EVERY = 300;

export interface PipelineRunOptions {
  runId: string;
  correlationId: string;
  browser: BrowserContext;
  signal: AbortSignal;
  proxies?: string[];
}

export interface IngestRunSummary {
  runId: string;
  storeSlug: string;
  status: RunStatus;
  captured: number;
  rejected: number;
  httpErrors: number;
  quarantined: boolean;
}

interface StoreLite {
  id: number;
  slug: StoreSlug;
  base_url: string;
  config: StoreConfig;
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

interface PendingLink {
  external_id: string;
  product_id: number | null;
  product_slug: string | null;
  method: 'ean' | 'semantic';
  score: string | null;
  status: 'auto' | 'pending_review';
}

interface PendingPrice {
  external_id: string;
  price_amount: string;
  currency: string;
  list_or_promo: 'list' | 'promo';
  unit_price: string | null;
  source_url: string;
  captured_at: Date;
  run_id: string;
}

export class IngestPipeline {
  private browser: BrowserContext | null = null;
  private readonly imageHashCache = new Map<string, Promise<string | null>>();

  constructor(
    private readonly db: Kysely<DB>,
    private readonly logger: Logger,
  ) {}

  async run(adapter: ScraperAdapter, opts: PipelineRunOptions): Promise<IngestRunSummary> {
    this.browser = opts.browser;
    this.imageHashCache.clear();
    const store = await this.loadStore(adapter.storeSlug);
    const log = this.logger.child({ runId: opts.runId, storeSlug: store.slug });
    const reporter = new RunReporter(this.db, log, {
      runId: opts.runId,
      correlationId: opts.correlationId,
      storeId: store.id,
    });
    await reporter.start();

    const http = new ResilientHttpClient({
      userAgents: UA_POOL,
      proxies: opts.proxies,
      maxConcurrent: store.config.maxConcurrent ?? 2,
      minDelayMs: store.config.delayMs?.[0] ?? 800,
      maxDelayMs: store.config.delayMs?.[1] ?? 2000,
      logger: log,
    });

    const ctx: AdapterContext = {
      runId: opts.runId,
      logger: log,
      http,
      browser: opts.browser,
      signal: opts.signal,
      storeConfig: store.config,
    };

    const allowedHosts = allowedHostsFor(store);
    const candidates = await this.loadCandidates();
    const productSlugToId = await this.loadProductSlugs();
    const categoryPathToId = await this.loadCategories();
    const latestPriceBySku = await this.loadLatestPrices(store.id);
    const statsBySku = await this.loadPriceStats(store.id);
    const seen = new Set<string>();
    let iteratorFailed = false;

    const pendingSkus: PendingSku[] = [];
    const pendingProducts: PendingProduct[] = [];
    const pendingLinks: PendingLink[] = [];
    const pendingPrices: PendingPrice[] = [];
    const createdSlugs = new Set<string>();
    const pendingImageRefines: Array<{ product_id: number; url: string; hash: string }> = [];

    const resolveCategoryId = (
      categoryPath: string[] | undefined,
      name?: string,
    ): number | null => {
      const storePath = matchCategoryByStorePath(categoryPath);
      const namePath = name ? matchCategoryByName(name) : null;
      let taxPath: string | null = null;
      if (storePath && namePath) {
        taxPath = storePath.split('/').length > namePath.split('/').length ? storePath : namePath;
      } else {
        taxPath = storePath ?? namePath;
      }
      if (taxPath) {
        const byPath = categoryPathToId.get(taxPath);
        if (byPath !== undefined) return byPath;
      }
      if (!categoryPath || categoryPath.length === 0) return null;
      const fullPath = categoryPath.map(normalizeToken).filter(Boolean).join('/');
      const exact = categoryPathToId.get(fullPath);
      if (exact !== undefined) return exact;
      const root = categoryPathToId.get(normalizeToken(categoryPath[0]!));
      return root ?? null;
    };

    /**
     * Persistencia en lote: productos nuevos, store_sku, match_link y
     * price_record se insertan con multi-row INSERT ... ON CONFLICT para
     * reducir round-trips a la DB (el sistema principal de ingesta diaria).
     * Devuelve el número de precios sospechosos marcados para el log.
     */
    const flushBuffer = async (): Promise<void> => {
      if (pendingSkus.length === 0 && pendingProducts.length === 0) return;

      // ---- productos nuevos ----
      if (pendingProducts.length > 0) {
        const unique = new Map<string, PendingProduct>();
        for (const p of pendingProducts) {
          if (!unique.has(p.slug)) unique.set(p.slug, p);
        }
        const ins = await this.db
          .insertInto('product')
          .values([...unique.values()])
          .onConflict((oc) => oc.column('slug').doUpdateSet({ updated_at: new Date() }))
          .returning(['id', 'slug'])
          .execute();
        for (const r of ins) {
          const id = Number(r.id);
          productSlugToId.set(r.slug, id);
          const prod = unique.get(r.slug);
          if (!prod || id <= 0) continue;
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
        pendingProducts.length = 0;
      }
      if (pendingSkus.length === 0) {
        pendingLinks.length = 0;
        pendingPrices.length = 0;
        return;
      }

      // ---- store_sku: dedupe por external_id dentro del lote (un mismo SKU
      // puede listarse en varias categorías) y multi-row upsert ----
      {
        const seenExt = new Set<string>();
        const keep: number[] = [];
        for (let i = 0; i < pendingSkus.length; i++) {
          const ext = pendingSkus[i]!.external_id;
          if (!seenExt.has(ext)) {
            seenExt.add(ext);
            keep.push(i);
          }
        }
        const keepSet = new Set(keep);
        pendingSkus.splice(0, pendingSkus.length, ...pendingSkus.filter((_, i) => keepSet.has(i)));
        pendingLinks.splice(
          0,
          pendingLinks.length,
          ...pendingLinks.filter((_, i) => keepSet.has(i)),
        );

        const ins = await this.db
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
        const extToSkuId = new Map<string, number>(ins.map((r) => [r.external_id, Number(r.id)]));
        pendingSkus.length = 0;

        // ---- match_link ----
        const links = pendingLinks
          .map((l) => {
            const skuId = extToSkuId.get(l.external_id);
            if (skuId === undefined) return null;
            const productId: number | undefined =
              l.product_id ?? (l.product_slug ? productSlugToId.get(l.product_slug) : undefined);
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
        pendingLinks.length = 0;
        if (links.length > 0) {
          await this.db
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

        // ---- price_record (con detección de sospechosos usando los mapas precargados) ----
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
              is_suspect: this.isPriceSuspect(
                skuId,
                Number(p.price_amount),
                latestPriceBySku,
                statsBySku,
                log,
              ),
            };
          })
          .filter((x) => x !== null);
        if (prices.length > 0) {
          await this.db
            .insertInto('price_record')
            .values(prices)
            .onConflict((oc) =>
              oc.columns(['store_sku_id', 'captured_at', 'list_or_promo']).doNothing(),
            )
            .execute();
        }
        pendingPrices.length = 0;
      }

      // ---- refinamiento de imagen (raro) ----
      if (pendingImageRefines.length > 0) {
        for (const ref of pendingImageRefines) {
          await this.db
            .updateTable('product')
            .set({ image_hash: ref.hash, image_url: ref.url })
            .where('id', '=', ref.product_id)
            .where((wb) =>
              wb.or([
                wb('image_url', 'is', null),
                wb('image_url', '=', ref.url as string),
                wb('image_hash', 'is', null),
              ]),
            )
            .execute();
        }
        pendingImageRefines.length = 0;
      }
    };

    try {
      for await (const raw of adapter.scrapeCatalog(ctx)) {
        const result = validateSnapshot(raw, { allowedHosts });
        if (!result.ok) {
          const externalId =
            typeof raw === 'object' && raw !== null && 'externalId' in raw
              ? String((raw as { externalId: unknown }).externalId)
              : '?';
          reporter.countRejected(result.reason, externalId);
          continue;
        }
        for (const warning of result.warnings) {
          log.warn({ event: 'snapshot.warning', warning }, 'warning de validación');
        }
        const snap = result.value;
        const dedupeKey = `${snap.externalId}:${snap.price.listOrPromo}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const norm = normalizeDescription(snap.rawDescription, {
          brand: snap.brand,
          description: snap.description,
        });

        let outcome = findBestMatch(norm, snap.ean, candidates, {
          autoThreshold: AUTO_MATCH_THRESHOLD,
        });
        const outProductId: number | null =
          outcome.method !== 'none' && 'productId' in outcome ? outcome.productId : null;
        let matched: MatchCandidate | undefined =
          outProductId !== null ? candidates.find((c) => c.productId === outProductId) : undefined;

        let incomingHash: string | null = null;
        if (snap.imageUrl && matched?.imageHash && matched.imageUrl !== snap.imageUrl) {
          incomingHash = await this.hashImage(snap.imageUrl);
          const refined = findBestMatch(norm, snap.ean, candidates, {
            autoThreshold: AUTO_MATCH_THRESHOLD,
            incomingImageHash: incomingHash,
          });
          outcome = refined;
          matched =
            refined.method !== 'none'
              ? candidates.find((c) => c.productId === refined.productId)
              : undefined;
        }

        let productId: number | null = null;
        let productSlug: string | null = null;
        let method: 'ean' | 'semantic' = 'semantic';
        let score: string | null = null;
        let linkStatus: 'auto' | 'pending_review' = 'auto';

        if (outcome.method === 'ean') {
          productId = outcome.productId;
          method = 'ean';
          score = '1';
          const matchedCand = candidates.find((c) => c.productId === productId);
          if (
            matchedCand &&
            (diceSimilarity(norm.normName, matchedCand.normName) < EAN_CONFLICT_SIMILARITY ||
              presentationConflict(norm, matchedCand))
          ) {
            linkStatus = 'pending_review';
            log.warn(
              { event: 'match.conflict.ean', skuId: snap.externalId, productId },
              'EAN compartido con descripciones dispares o presentación distinta',
            );
          }
        } else if (outcome.method === 'semantic') {
          productId = outcome.productId;
          method = 'semantic';
          score = outcome.score.toFixed(4);
        } else if (outcome.bestCandidateId !== null && outcome.bestScore >= REVIEW_THRESHOLD) {
          productId = outcome.bestCandidateId;
          method = 'semantic';
          score = outcome.bestScore.toFixed(4);
          linkStatus = 'pending_review';
          log.info(
            { event: 'match.pending_review', skuId: snap.externalId, productId, score },
            'match dudoso enviado a revisión',
          );
        } else {
          const catId = resolveCategoryId(snap.categoryPath, norm.normName);
          const slug = this.forgeSlug(norm, snap);
          if (createdSlugs.has(slug)) {
            productSlug = slug;
          } else {
            const existingId = productSlugToId.get(slug);
            if (existingId !== undefined) {
              productId = existingId;
              method = 'semantic';
              score = '0.82';
            } else {
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
              productSlug = slug;
            }
          }
        }

        pendingSkus.push({
          store_id: store.id,
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
          status: linkStatus,
        });
        pendingPrices.push({
          external_id: snap.externalId,
          price_amount: snap.price.amount.toFixed(2),
          currency: 'ARS',
          list_or_promo: snap.price.listOrPromo,
          unit_price: snap.price.unitPrice !== undefined ? snap.price.unitPrice.toFixed(3) : null,
          source_url: snap.url,
          captured_at: new Date(snap.capturedAt),
          run_id: opts.runId,
        });
        if (incomingHash && snap.imageUrl && productId !== null) {
          pendingImageRefines.push({
            product_id: productId,
            url: snap.imageUrl,
            hash: incomingHash,
          });
        }
        reporter.countCaptured();

        if (pendingSkus.length >= FLUSH_EVERY) {
          await flushBuffer();
        }
      }
    } catch (err) {
      iteratorFailed = true;
      reporter.countHttpError(err);
      log.error({ event: 'ingest.iterator.failed', err }, 'iteración del catálogo falló');
    } finally {
      // Vaciar el lote restante incluso si el iterador falló/timeout.
      try {
        await flushBuffer();
      } catch (err) {
        reporter.countHttpError(err);
        log.error({ err }, 'fallo persistiendo el lote final');
      }
    }

    const stats = reporter.stats;
    const status = resolveStatus({ ...stats, iteratorFailed });
    const { quarantined } = await reporter.finish(status);

    return { runId: opts.runId, storeSlug: store.slug, status, ...stats, quarantined };
  }

  /**
   * Detección de precio sospechoso para un store_sku_id usando solo los mapas
   * precargados (sin queries por snapshot). Umbral clásico >80% + z-score >4
   * sobre la ventana de 90 días cuando hay suficiente historial.
   */
  private isPriceSuspect(
    skuId: number,
    amount: number,
    latestBySku: Map<number, number>,
    statsBySku: Map<number, { n: number; avg: number; stddev: number | null }>,
    log: Logger,
  ): boolean {
    const previous = latestBySku.get(skuId) ?? null;
    const change = previous !== null ? pctChange(amount, previous) : null;
    let isSuspect = change !== null && Math.abs(change) > 80;
    if (!isSuspect) {
      const stats = statsBySku.get(skuId);
      if (stats && stats.n >= 5 && stats.stddev !== null && stats.stddev > 0) {
        const z = Math.abs((amount - stats.avg) / stats.stddev);
        if (z > 4) isSuspect = true;
      }
    }
    if (isSuspect) {
      log.warn(
        { event: 'price.suspect.flagged', skuId, previous, current: amount },
        'variación sospechosa marcada',
      );
    }
    return isSuspect;
  }

  private async loadStore(slug: StoreSlug): Promise<StoreLite> {
    const store = await this.db
      .selectFrom('store')
      .select(['id', 'slug', 'base_url', 'config'])
      .where('slug', '=', slug)
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirst();
    if (!store) throw new AppError('not_found', `Tienda inactiva o inexistente: ${slug}`);
    return {
      id: Number(store.id),
      slug: store.slug,
      base_url: store.base_url,
      config: store.config,
    };
  }

  private async loadCandidates(): Promise<MatchCandidate[]> {
    const rows = await this.db
      .selectFrom('product')
      .select([
        'product.id',
        'product.ean',
        'product.canonical_name',
        'product.brand',
        'product.unit_amount',
        'product.unit_type',
        'product.image_url',
        'product.image_hash',
      ])
      .orderBy('product.updated_at', 'desc')
      .limit(CANDIDATE_POOL_SIZE)
      .execute();

    const descriptions = await this.loadCandidateDescriptions(rows.map((r) => r.id));
    const packInfos = await this.loadCandidatePackInfos(rows.map((r) => r.id));

    return rows.map((r) => {
      const desc = descriptions.get(Number(r.id)) ?? null;
      const descText = desc?.description ?? null;
      const n = normalizeDescription(r.canonical_name, {
        brand: r.brand,
        description: descText,
      });
      const context =
        descText && descText !== r.canonical_name
          ? normalizeDescription(r.canonical_name, {
              brand: r.brand,
              description: descText,
            }).contextText
          : n.contextText;
      const pack = packInfos.get(Number(r.id)) ?? {
        count: n.unitCount,
        declared: n.isPack,
        isPack: n.isPack,
      };
      return {
        productId: r.id,
        ean: r.ean,
        normName: n.normName,
        unitAmount: r.unit_amount !== null ? Number(r.unit_amount) : null,
        unitType: r.unit_type,
        unitCount: pack.count,
        isPack: pack.isPack,
        brand: r.brand,
        brandProvided: n.brandProvided,
        typeKeys: n.typeKeys,
        variantFlags: n.variantFlags,
        imageHash: r.image_hash,
        imageUrl: r.image_url,
        contextText: context,
      };
    });
  }

  private async loadProductSlugs(): Promise<Map<string, number>> {
    const rows = await this.db.selectFrom('product').select(['id', 'slug']).execute();
    return new Map(rows.map((r) => [r.slug, Number(r.id)]));
  }

  private async loadCategories(): Promise<Map<string, number>> {
    const rows = await this.db.selectFrom('category').select(['id', 'path']).execute();
    return new Map(rows.map((c) => [c.path, Number(c.id)]));
  }

  /**
   * Precio no sospechoso más reciente por store_sku_id de la tienda. Usa una
   * sola query (distinct on) en lugar de una por snapshot. Si el ejecutor SQL
   * crudo no está disponible (p. ej. fake-db en tests) degrada a una consulta
   * armada con builders y reduce en memoria.
   */
  private async loadLatestPrices(storeId: number): Promise<Map<number, number>> {
    try {
      const rows = await sql<{ store_sku_id: number; price_amount: string }>`
        select distinct on (pr.store_sku_id)
               pr.store_sku_id, pr.price_amount::text as price_amount
        from price_record pr
        join store_sku ss on ss.id = pr.store_sku_id
        where ss.store_id = ${storeId} and pr.is_suspect = false
        order by pr.store_sku_id, pr.captured_at desc
      `.execute(this.db);
      return new Map(rows.rows.map((r) => [Number(r.store_sku_id), Number(r.price_amount)]));
    } catch (err) {
      this.logger.debug(
        { err, event: 'price.latest.prefetch_fallback' },
        'fallback: últimos precios por consulta simple',
      );
      const storeSkus = await this.db
        .selectFrom('store_sku')
        .select(['id'])
        .where('store_id', '=', storeId)
        .execute();
      const idSet = new Set(storeSkus.map((r) => Number(r.id)));
      if (idSet.size === 0) return new Map();
      const rows = await this.db
        .selectFrom('price_record')
        .select(['store_sku_id', 'price_amount', 'captured_at'])
        .where('is_suspect', '=', false)
        .orderBy('captured_at', 'desc')
        .execute();
      const map = new Map<number, number>();
      for (const r of rows) {
        const skuId = Number(r.store_sku_id);
        if (idSet.has(skuId) && !map.has(skuId)) map.set(skuId, Number(r.price_amount));
      }
      return map;
    }
  }

  /**
   * Estadística de 90 días (n, avg, stddev) por store_sku_id de la tienda.
   * Una sola query en lugar de una por snapshot.
   */
  private async loadPriceStats(
    storeId: number,
  ): Promise<Map<number, { n: number; avg: number; stddev: number | null }>> {
    try {
      const rows = await sql<{
        store_sku_id: number;
        recent_avg: string;
        recent_stddev: string | null;
        recent_n: number;
      }>`
        select pr.store_sku_id,
               avg(pr.price_amount::numeric)::text as recent_avg,
               stddev_samp(pr.price_amount::numeric)::text as recent_stddev,
               count(*)::int as recent_n
        from price_record pr
        join store_sku ss on ss.id = pr.store_sku_id
        where ss.store_id = ${storeId}
          and pr.is_suspect = false
          and pr.captured_at >= now() - interval '90 days'
        group by pr.store_sku_id
      `.execute(this.db);
      const map = new Map<number, { n: number; avg: number; stddev: number | null }>();
      for (const r of rows.rows) {
        map.set(Number(r.store_sku_id), {
          n: Number(r.recent_n ?? 0),
          avg: Number(r.recent_avg),
          stddev: r.recent_stddev !== null ? Number(r.recent_stddev) : null,
        });
      }
      return map;
    } catch (err) {
      this.logger.debug(
        { err, event: 'price.stats.prefetch_fallback' },
        'estadística 90d no disponible, usando umbral fijo',
      );
      return new Map();
    }
  }

  /**
   * Presentación agregada (pack/unidades) por producto a partir de los NOMBRES
   * de sus SKUs vinculados: preserva el conteo que el nombre canónico pierde al
   * normalizarse y evita el ruido de las descripciones de marketing.
   */
  private async loadCandidatePackInfos(productIds: number[]): Promise<Map<number, PackInfo>> {
    if (productIds.length === 0) return new Map();
    const rows: Array<{ raw_description: string | null; product_id: string | number }> =
      await this.db
        .selectFrom('store_sku')
        .innerJoin('match_link', 'match_link.store_sku_id', 'store_sku.id')
        .select(['store_sku.raw_description', 'match_link.product_id'])
        .where('match_link.status', '<>', 'rejected')
        .where('match_link.product_id', 'in', productIds)
        .execute();
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

  /**
   * Descripción más completa (la más larga) por producto, como contexto de
   * similitud para confirmar que los enlaces corresponden al mismo producto
   * y no a uno similar de otra marca o medida.
   */
  private async loadCandidateDescriptions(
    productIds: number[],
  ): Promise<Map<number, { description: string | null; raw_description: string }>> {
    if (productIds.length === 0) return new Map();
    const rows: Array<{
      description: string | null;
      raw_description: string;
      product_id: string | number;
    }> = await this.db
      .selectFrom('store_sku')
      .innerJoin('match_link', 'match_link.store_sku_id', 'store_sku.id')
      .select(['store_sku.description', 'store_sku.raw_description', 'match_link.product_id'])
      .where('match_link.status', '<>', 'rejected')
      .where('match_link.product_id', 'in', productIds)
      .execute();
    const map = new Map<number, { description: string | null; raw_description: string }>();
    for (const row of rows) {
      const pid = Number(row.product_id);
      const description = row.description ?? row.raw_description;
      const existing = map.get(pid);
      if (!existing || (description?.length ?? 0) > (existing.description?.length ?? 0)) {
        map.set(pid, { description, raw_description: row.raw_description });
      }
    }
    return map;
  }

  private async hashImage(url: string | undefined): Promise<string | null> {
    if (!url || !this.browser) return null;
    const cached = this.imageHashCache.get(url);
    if (cached) return cached;
    const pending = computeImageHash(this.browser, url);
    this.imageHashCache.set(url, pending);
    return pending;
  }

  private forgeSlug(norm: ReturnType<typeof normalizeDescription>, snap: ProductSnapshot): string {
    const slugBase = norm.normName.replace(/\s+/g, '-').slice(0, 60) || 'producto';
    const hash = createHash('sha1')
      .update(snap.ean ?? norm.normName)
      .digest('base64url')
      .slice(0, 6);
    return `${slugBase}-${hash}`;
  }
}

function allowedHostsFor(store: StoreLite): string[] {
  const baseHost = new URL(store.base_url).hostname.toLowerCase().replace(/^www\./, '');
  return [baseHost, ...(store.config.extraHosts ?? [])];
}
