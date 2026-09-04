import type { ProductSnapshot } from '@precios/shared';
import {
  extractVtexApolloItems,
  fetchVtexCategoryPage,
  fetchVtexLeafCategories,
  type AdapterContext,
  type ListingRef,
  type ScraperAdapter,
  type VtexItemRecord,
  VTEX_PAGE_SIZE,
} from '@precios/scraper-core';

const BASE_URL = 'https://www.carrefour.com.ar';

/** Sin filtro de raíces: se captura el catálogo completo de la tienda. */

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

async function* discoverListings(ctx: AdapterContext): AsyncGenerator<ListingRef, void, void> {
  const leaves = await fetchVtexLeafCategories(BASE_URL, ctx.http, ctx.signal);
  for (const leaf of leaves) {
    yield { url: leaf.url, externalId: leaf.relativePath };
  }
}

async function* crawlCatalog(ctx: AdapterContext): AsyncGenerator<ProductSnapshot, void, void> {
  const leaves = await fetchVtexLeafCategories(BASE_URL, ctx.http, ctx.signal);
  let yielded = 0;
  let lastError: unknown;

  for (const leaf of leaves) {
    ctx.signal.throwIfAborted();
    let from = 0;
    try {
      while (true) {
        const page = await fetchVtexCategoryPage(
          BASE_URL,
          leaf.relativePath,
          from,
          ctx.http,
          ctx.signal,
        );
        if (page.length === 0) break;
        const capturedAt = new Date();
        for (const rec of page) {
          const snap = toSnapshot(rec, capturedAt);
          if (snap.price.amount > 0) {
            yielded++;
            yield snap;
          }
        }
        if (page.length < VTEX_PAGE_SIZE) break;
        from += VTEX_PAGE_SIZE;
      }
    } catch (err) {
      lastError = err;
      ctx.logger.warn(
        { event: 'adapter.listing.failed', category: leaf.relativePath, err },
        'categoría falló',
      );
    }
  }

  if (yielded === 0 && lastError !== undefined) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

const adapter: ScraperAdapter = {
  storeSlug: 'carrefour',

  discover: discoverListings,

  scrapeCatalog: crawlCatalog,

  async scrapeProduct(ref: ListingRef, ctx: AdapterContext): Promise<ProductSnapshot | null> {
    ctx.signal.throwIfAborted();
    const externalId = ref.externalId ?? /\/p\/(\w+)/.exec(new URL(ref.url).pathname)?.[1];
    const leaves = await fetchVtexLeafCategories(BASE_URL, ctx.http, ctx.signal);
    for (const leaf of leaves) {
      let from = 0;
      while (true) {
        const page = await fetchVtexCategoryPage(
          BASE_URL,
          leaf.relativePath,
          from,
          ctx.http,
          ctx.signal,
        );
        if (page.length === 0) break;
        for (const rec of page) {
          if (externalId && rec.itemId === externalId) return toSnapshot(rec, new Date());
        }
        if (page.length < VTEX_PAGE_SIZE) break;
        from += VTEX_PAGE_SIZE;
      }
    }
    return null;
  },
};

export default adapter;
