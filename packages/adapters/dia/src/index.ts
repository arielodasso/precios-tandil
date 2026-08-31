import type { ProductSnapshot } from '@precios/shared';
import {
  extractVtexApolloItems,
  type AdapterContext,
  type ListingRef,
  type ScraperAdapter,
  type VtexItemRecord,
} from '@precios/scraper-core';

const BASE_URL = 'https://diaonline.supermercadosdia.com.ar';
const LISTING_PATHS = [
  '/almacen',
  '/arroz',
  '/yerba',
  '/aceite-girasol',
  '/fideos',
  '/azucar',
  '/leche',
  '/harina',
  '/perfumeria',
  '/limpieza',
];
const PAGE_TIMEOUT_MS = 30_000;
const CACHE_WAIT_MS = 15_000;

function toSnapshot(rec: VtexItemRecord, capturedAt: Date): ProductSnapshot {
  return {
    externalId: rec.itemId,
    url: rec.url,
    rawDescription: rec.name,
    description: rec.description ?? undefined,
    ean: rec.ean ?? undefined,
    brand: rec.brand ?? undefined,
    categoryPath: rec.categoryPath ?? undefined,
    unitLabel: rec.unitLabel ?? undefined,
    price: {
      amount: rec.priceAmount,
      listOrPromo: rec.listOrPromo,
    },
    imageUrl: rec.imageUrl ?? undefined,
    capturedAt: capturedAt.toISOString(),
  };
}

export function parseListing(html: string, capturedAt: Date = new Date()): ProductSnapshot[] {
  const items = extractVtexApolloItems(html, { baseUrl: BASE_URL });
  return items.map((rec) => toSnapshot(rec, capturedAt)).filter((s) => s.price.amount > 0);
}

async function fetchListingHtml(ctx: AdapterContext, url: string): Promise<string> {
  ctx.signal.throwIfAborted();
  const page = await ctx.browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    await page
      .locator('script')
      .filter({ hasText: '{"Product' })
      .first()
      .waitFor({ timeout: CACHE_WAIT_MS })
      .catch(() => undefined);
    return await page.content();
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function* discoverListings(): AsyncGenerator<ListingRef, void, void> {
  for (const path of LISTING_PATHS) {
    yield { url: `${BASE_URL}${path}` };
  }
}

const adapter: ScraperAdapter = {
  storeSlug: 'dia',

  discover: discoverListings,

  async *scrapeCatalog(ctx: AdapterContext): AsyncGenerator<ProductSnapshot, void, void> {
    let yielded = 0;
    let lastError: unknown;
    for await (const ref of discoverListings()) {
      try {
        const html = await fetchListingHtml(ctx, ref.url);
        const snapshots = parseListing(html);
        yielded += snapshots.length;
        for (const snap of snapshots) yield snap;
      } catch (err) {
        lastError = err;
        ctx.logger.warn({ event: 'adapter.listing.failed', url: ref.url, err }, 'listado falló');
      }
    }
    if (yielded === 0 && lastError !== undefined) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
  },

  async scrapeProduct(ref: ListingRef, ctx: AdapterContext): Promise<ProductSnapshot | null> {
    ctx.signal.throwIfAborted();
    const html = await fetchListingHtml(ctx, ref.url);
    const snapshots = parseListing(html);
    if (snapshots.length === 0) return null;
    if (ref.externalId) {
      return snapshots.find((s) => s.externalId === ref.externalId) ?? null;
    }
    const target = new URL(ref.url).pathname.replace(/\/$/, '');
    return snapshots.find((s) => new URL(s.url).pathname.replace(/\/$/, '') === target) ?? null;
  },
};

export default adapter;
