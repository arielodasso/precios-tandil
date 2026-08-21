import type { Logger } from 'pino';
import type { BrowserContext } from 'playwright';
import type { ProductSnapshot, StoreConfig, StoreSlug } from '@precios/shared';
import type { ResilientHttpClient } from './http/resilient-http-client.ts';

export interface ListingRef {
  url: string;
  externalId?: string;
}

export interface AdapterContext {
  runId: string;
  logger: Logger;
  http: ResilientHttpClient;
  browser: BrowserContext;
  signal: AbortSignal;
  storeConfig: StoreConfig;
}

export interface ScraperAdapter {
  readonly storeSlug: StoreSlug;

  discover(ctx: AdapterContext): AsyncIterable<ListingRef>;

  scrapeProduct(ref: ListingRef, ctx: AdapterContext): Promise<ProductSnapshot | null>;

  scrapeCatalog(ctx: AdapterContext): AsyncIterable<ProductSnapshot>;
}
