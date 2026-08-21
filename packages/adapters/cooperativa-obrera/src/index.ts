import { AppError, type ProductSnapshot } from '@precios/shared';
import type { AdapterContext, ListingRef, ScraperAdapter } from '@precios/scraper-core';

const NOT_IMPLEMENTED = 'Adaptador Cooperativa Obrera se implementa en US1 (T034)';

async function* failCatalog(_ctx: AdapterContext): AsyncGenerator<ProductSnapshot, never, void> {
  throw new AppError('adapter_missing', NOT_IMPLEMENTED);
}

const adapter: ScraperAdapter = {
  storeSlug: 'carrefour',

  async *discover(_ctx: AdapterContext): AsyncGenerator<ListingRef, never, void> {
    throw new AppError('adapter_missing', NOT_IMPLEMENTED);
  },

  scrapeCatalog: failCatalog,

  async scrapeProduct(_ref, _ctx): Promise<ProductSnapshot | null> {
    throw new AppError('adapter_missing', NOT_IMPLEMENTED);
  },
};

export default adapter;
