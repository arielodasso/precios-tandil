import type { StoreSlug } from '@precios/shared';
import type { ScraperAdapter } from '@precios/scraper-core';

type AdapterModule = { default: ScraperAdapter };

const LOADERS: Array<[StoreSlug, () => Promise<AdapterModule>]> = [
  ['carrefour', () => import('@precios/adapters-carrefour')],
  ['monarca', () => import('@precios/adapters-monarca')],
  ['comerciante-maxi', () => import('@precios/adapters-comerciante-maxi')],
  ['dia', () => import('@precios/adapters-dia')],
  ['cooperativa-obrera', () => import('@precios/adapters-cooperativa-obrera')],
  ['vea', () => import('@precios/adapters-vea')],
];

export async function loadAdapters(logger: {
  warn: (msg: string, err?: unknown) => void;
}): Promise<Map<StoreSlug, ScraperAdapter>> {
  const registry = new Map<StoreSlug, ScraperAdapter>();
  for (const [slug, load] of LOADERS) {
    try {
      const mod = await load();
      registry.set(slug, mod.default);
    } catch (err) {
      logger.warn(`adaptador ${slug} no disponible aún`, err);
    }
  }
  return registry;
}
