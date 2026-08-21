import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
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
  diceSimilarity,
  findBestMatch,
  normalizeDescription,
  type MatchCandidate,
} from '@precios/normalizer';
import { RunReporter, resolveStatus } from './run-reporter.ts';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
];

const AUTO_MATCH_THRESHOLD = 0.82;
const REVIEW_THRESHOLD = 0.65;
const EAN_CONFLICT_SIMILARITY = 0.5;

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

export class IngestPipeline {
  constructor(
    private readonly db: Kysely<DB>,
    private readonly logger: Logger,
  ) {}

  async run(adapter: ScraperAdapter, opts: PipelineRunOptions): Promise<IngestRunSummary> {
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
    const seen = new Set<string>();
    let iteratorFailed = false;

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

        try {
          await this.persistSnapshot(store, snap, candidates, opts.runId, log);
          reporter.countCaptured();
        } catch (err) {
          log.error({ err }, 'fallo persistiendo snapshot');
          reporter.countHttpError(err);
        }
      }
    } catch (err) {
      iteratorFailed = true;
      reporter.countHttpError(err);
      log.error({ event: 'ingest.iterator.failed', err }, 'iteración del catálogo falló');
    }

    const stats = reporter.stats;
    const status = resolveStatus({ ...stats, iteratorFailed });
    const { quarantined } = await reporter.finish(status);

    return { runId: opts.runId, storeSlug: store.slug, status, ...stats, quarantined };
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
      .select(['id', 'ean', 'canonical_name', 'unit_amount', 'unit_type'])
      .orderBy('updated_at', 'desc')
      .limit(2000)
      .execute();
    return rows.map((r) => ({
      productId: r.id,
      ean: r.ean,
      normName: normalizeDescription(r.canonical_name).normName,
      unitAmount: r.unit_amount !== null ? Number(r.unit_amount) : null,
      unitType: r.unit_type,
    }));
  }

  private async persistSnapshot(
    store: StoreLite,
    snap: ProductSnapshot,
    candidates: MatchCandidate[],
    runId: string,
    log: Logger,
  ): Promise<void> {
    const norm = normalizeDescription(snap.rawDescription);

    const sku = await this.db
      .insertInto('store_sku')
      .values({
        store_id: store.id,
        external_id: snap.externalId,
        url: snap.url,
        raw_description: snap.rawDescription,
        declared_ean: snap.ean ?? null,
        unit_label: snap.unitLabel ?? null,
        last_seen_at: new Date(),
        is_active: true,
      })
      .onConflict((oc) =>
        oc.columns(['store_id', 'external_id']).doUpdateSet({
          url: snap.url,
          raw_description: snap.rawDescription,
          declared_ean: snap.ean ?? null,
          unit_label: snap.unitLabel ?? null,
          last_seen_at: new Date(),
          is_active: true,
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    const skuId = Number(sku.id);

    const outcome = findBestMatch(norm, snap.ean, candidates, {
      autoThreshold: AUTO_MATCH_THRESHOLD,
    });

    let productId: number;
    let method: 'ean' | 'semantic';
    let score: number | null;
    let linkStatus: 'auto' | 'pending_review' = 'auto';

    if (outcome.method === 'ean') {
      productId = outcome.productId;
      method = 'ean';
      score = 1;
      const matched = candidates.find((c) => c.productId === productId);
      if (matched && diceSimilarity(norm.normName, matched.normName) < EAN_CONFLICT_SIMILARITY) {
        linkStatus = 'pending_review';
        log.warn(
          { event: 'match.conflict.ean', skuId, productId },
          'EAN compartido con descripciones dispares',
        );
      }
    } else if (outcome.method === 'semantic') {
      productId = outcome.productId;
      method = 'semantic';
      score = outcome.score;
    } else if (outcome.bestCandidateId !== null && outcome.bestScore >= REVIEW_THRESHOLD) {
      productId = outcome.bestCandidateId;
      method = 'semantic';
      score = outcome.bestScore;
      linkStatus = 'pending_review';
      log.info(
        { event: 'match.pending_review', skuId, productId, score },
        'match dudoso enviado a revisión',
      );
    } else {
      productId = await this.createProduct(norm, snap);
      method = 'semantic';
      score = null;
      candidates.push({
        productId,
        ean: snap.ean ?? null,
        normName: norm.normName,
        unitAmount: norm.unitAmount,
        unitType: norm.unitType,
      });
    }

    await this.db
      .insertInto('match_link')
      .values({
        store_sku_id: skuId,
        product_id: productId,
        method,
        score: score !== null ? score.toFixed(4) : null,
        status: linkStatus,
      })
      .onConflict((oc) =>
        oc.column('store_sku_id').doUpdateSet({
          product_id: productId,
          method,
          score: score !== null ? score.toFixed(4) : null,
          status: linkStatus,
        }),
      )
      .execute();

    const last = await this.db
      .selectFrom('price_record')
      .select('price_amount')
      .where('store_sku_id', '=', skuId)
      .where('is_suspect', '=', false)
      .orderBy('captured_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    const previous = last !== undefined ? Number(last.price_amount) : null;
    const change = previous !== null ? pctChange(snap.price.amount, previous) : null;
    const isSuspect = change !== null && Math.abs(change) > 80;
    if (isSuspect) {
      log.warn(
        { event: 'price.suspect.flagged', previous, current: snap.price.amount, change },
        'variación sospechosa marcada',
      );
    }

    await this.db
      .insertInto('price_record')
      .values({
        store_sku_id: skuId,
        price_amount: snap.price.amount.toFixed(2),
        currency: 'ARS',
        list_or_promo: snap.price.listOrPromo,
        unit_price: snap.price.unitPrice !== undefined ? snap.price.unitPrice.toFixed(3) : null,
        source_url: snap.url,
        captured_at: new Date(snap.capturedAt),
        run_id: runId,
        is_suspect: isSuspect,
      })
      .onConflict((oc) => oc.columns(['store_sku_id', 'captured_at', 'list_or_promo']).doNothing())
      .execute();
  }

  private async createProduct(
    norm: ReturnType<typeof normalizeDescription>,
    snap: ProductSnapshot,
  ): Promise<number> {
    const slugBase = norm.normName.replace(/\s+/g, '-').slice(0, 60) || 'producto';
    const hash = createHash('sha1')
      .update(snap.ean ?? norm.normName)
      .digest('base64url')
      .slice(0, 6);
    const slug = `${slugBase}-${hash}`;
    const categoryId = await this.resolveCategory(snap.categoryPath);

    const inserted = await this.db
      .insertInto('product')
      .values({
        slug,
        canonical_name: norm.normName,
        brand: norm.brand ?? snap.brand ?? null,
        ean: snap.ean ?? null,
        unit_amount: norm.unitAmount !== null ? String(norm.unitAmount) : null,
        unit_type: norm.unitType,
        image_url: snap.imageUrl ?? null,
        category_id: categoryId,
      })
      .onConflict((oc) => oc.column('slug').doUpdateSet({ updated_at: new Date() }))
      .returning('id')
      .executeTakeFirstOrThrow();
    return Number(inserted.id);
  }

  private async resolveCategory(categoryPath: string[] | undefined): Promise<number | null> {
    if (!categoryPath || categoryPath.length === 0) return null;
    const fullPath = categoryPath.join('/');
    const exact = await this.db
      .selectFrom('category')
      .select('id')
      .where('path', '=', fullPath)
      .limit(1)
      .executeTakeFirst();
    if (exact) return exact.id;
    const root = await this.db
      .selectFrom('category')
      .select('id')
      .where('path', '=', categoryPath[0]!)
      .limit(1)
      .executeTakeFirst();
    return root?.id ?? null;
  }
}

function allowedHostsFor(store: StoreLite): string[] {
  const baseHost = new URL(store.base_url).hostname.toLowerCase().replace(/^www\./, '');
  return [baseHost, ...(store.config.extraHosts ?? [])];
}
