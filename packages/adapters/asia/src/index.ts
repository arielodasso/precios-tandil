import type { ProductSnapshot } from '@precios/shared';
import type { AdapterContext, ListingRef, ScraperAdapter } from '@precios/scraper-core';

const CATALOG_URL = 'https://asiasupermercado.ar/api/shop?action=catalog';

interface AsiaProduct {
  id: string;
  name: string;
  barcode?: string | null;
  size?: string | null;
  category?: string | null;
  price: number;
  regular?: number | null;
  isOffer?: boolean;
  promotion?: string | null;
  imageUrl?: string | null;
}

const adapter: ScraperAdapter = {
  storeSlug: 'asia' as any,

  async *discover(_ctx: AdapterContext): AsyncGenerator<ListingRef, void, void> {
    yield { url: CATALOG_URL, externalId: 'catalog' };
  },

  async *scrapeCatalog(ctx: AdapterContext): AsyncGenerator<ProductSnapshot, void, void> {
    const res = await fetch(CATALOG_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PreciosTandil/1.0)' },
      signal: ctx.signal,
    });

    if (!res.ok) {
      throw new Error(`Asia API falló con status ${res.status}`);
    }

    const data = await res.json();
    const products: AsiaProduct[] = data.products || [];
    const now = new Date().toISOString();

    for (const p of products) {
      if (!p.price || p.price <= 0) continue;

      const validEan = p.barcode && /^\d{13}$/.test(p.barcode) ? p.barcode : undefined;
      const imageUrl = p.imageUrl
        ? p.imageUrl.startsWith('http')
          ? p.imageUrl
          : `https://asiasupermercado.ar${p.imageUrl}`
        : undefined;

      const snapshot: ProductSnapshot = {
        externalId: String(p.id),
        url: 'https://asiasupermercado.ar/',
        rawDescription: p.name.trim(),
        ean: validEan,
        categoryPath: p.category ? [p.category] : undefined,
        unitLabel: p.size || undefined,
        price: {
          amount: p.price,
          listOrPromo: p.isOffer ? 'promo' : 'list',
          promoLabel: p.promotion || undefined,
        },
        imageUrl,
        capturedAt: now,
      };

      yield snapshot;
    }
  },

  async scrapeProduct(_ref: ListingRef, _ctx: AdapterContext): Promise<ProductSnapshot | null> {
    return null;
  },
};

export default adapter;
