import type { ProductSnapshot } from '@precios/shared';
import { type AdapterContext, type ListingRef, type ScraperAdapter } from '@precios/scraper-core';

export const APP_URL = 'https://www.golopolis.com.ar/app/';

export interface GolopolisCategoryRef {
  superItemId: number;
  itemId: number;
  label: string;
}

/**
 * Categorías de golopolis.com.ar (href del menú: ?action=products&superItemId=N&itemId=M).
 * La plataforma renderiza TODO el listado server-side (sin paginación real:
 * `pagine=2` devuelve 0 productos), por eso alcanza con una petición por categoría.
 */
export const LISTING_CATEGORIES: GolopolisCategoryRef[] = [
  { superItemId: 1, itemId: 1, label: 'Aceites' },
  { superItemId: 1, itemId: 2, label: 'Aderezos' },
  { superItemId: 1, itemId: 6, label: 'Arroz y Legumbres' },
  { superItemId: 1, itemId: 7, label: 'Azucar y Edulcorantes' },
  { superItemId: 1, itemId: 51, label: 'Fideos y Pastas' },
  { superItemId: 1, itemId: 36, label: 'Harinas y Premezclas' },
  { superItemId: 1, itemId: 37, label: 'Infusiones' },
  { superItemId: 1, itemId: 40, label: 'Lacteos' },
  { superItemId: 2, itemId: 3, label: 'Agua' },
  { superItemId: 2, itemId: 34, label: 'Gaseosas' },
  { superItemId: 2, itemId: 14, label: 'Cervezas' },
  { superItemId: 6, itemId: 44, label: 'Limpieza del Hogar' },
  { superItemId: 6, itemId: 43, label: 'Limpieza de Cocina' },
  { superItemId: 6, itemId: 42, label: 'Limpieza de Bano' },
  { superItemId: 6, itemId: 38, label: 'Jabones' },
  { superItemId: 7, itemId: 20, label: 'Cuidado del Cabello' },
  { superItemId: 7, itemId: 19, label: 'Cuidado Bucal' },
  { superItemId: 7, itemId: 23, label: 'Desodorantes' },
  { superItemId: 7, itemId: 99, label: 'Cuidado de Cuerpo' },
];

export interface GolopolisProductImage {
  name?: unknown;
}

export interface GolopolisProduct {
  id?: unknown;
  foreign_id?: unknown;
  ean?: unknown;
  name?: unknown;
  extended_description?: unknown;
  brand?: unknown;
  super?: unknown;
  webItem?: unknown;
  category?: unknown;
  price?: unknown;
  originalPrice?: unknown;
  discount?: unknown;
  promotion_id?: unknown;
  imagesList?: GolopolisProductImage[] | null;
}

export function createListingUrl(ref: GolopolisCategoryRef): string {
  return `${APP_URL}?action=products&superItemId=${ref.superItemId}&itemId=${ref.itemId}`;
}

/** Extrae `var aProducts = [...]` (JSON) embebido en el HTML de Golopolis. */
export function extractProducts(html: string): GolopolisProduct[] {
  const match = /var aProducts\s*=\s*(\[[\s\S]*?\])\s*;/.exec(html);
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]!);
    return Array.isArray(data) ? (data as GolopolisProduct[]) : [];
  } catch {
    return [];
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function toSnapshot(
  product: GolopolisProduct,
  capturedAt: Date,
  listingLabel?: string,
): ProductSnapshot | null {
  const name = str(product.name);
  if (!name) return null;

  const foreignId = str(product.foreign_id) ?? str(product.id);
  if (!foreignId) return null;

  const price = num(product.price);
  if (price === null || price <= 0) return null;

  const originalPrice = num(product.originalPrice);
  const list = originalPrice !== null && originalPrice > price ? originalPrice : price;
  const isPromo = list > price;

  const eanRaw = str(product.ean);
  const ean = eanRaw && /^\d{13}$/.test(eanRaw) ? eanRaw : undefined;

  const brand = str(product.brand);
  const extended = str(product.extended_description);

  const firstImage = product.imagesList
    ? product.imagesList
        .map((img) => img?.name)
        .find((n): n is string => typeof n === 'string' && n.length > 0)
    : undefined;
  const imageUrl = firstImage
    ? firstImage.startsWith('http')
      ? firstImage
      : new URL(firstImage, APP_URL).toString()
    : undefined;

  const superCat = str(product.super);
  const webItem = str(product.webItem) ?? str(product.category);
  const categoryPath = [superCat, webItem ?? listingLabel].filter(
    (x): x is string => x !== null && x !== undefined && x.length > 0,
  );
  const finalPath = categoryPath.length > 0 ? categoryPath : undefined;

  const enrichedRaw = extended
    ? collapse(`${name} ${extended}`.slice(0, 500))
    : collapse(name).slice(0, 500);

  return {
    externalId: foreignId,
    url: `${APP_URL}?action=detail&itemId=${encodeURIComponent(foreignId)}`,
    rawDescription: enrichedRaw,
    description: extended ?? undefined,
    ean,
    brand: brand ? collapse(brand).slice(0, 120) : undefined,
    categoryPath: finalPath,
    price: {
      amount: price,
      listOrPromo: isPromo ? 'promo' : 'list',
    },
    imageUrl,
    capturedAt: capturedAt.toISOString(),
  };
}

export function parseProducts(
  items: GolopolisProduct[],
  capturedAt: Date = new Date(),
  listingLabel?: string,
): ProductSnapshot[] {
  const out: ProductSnapshot[] = [];
  for (const item of items) {
    const snap = toSnapshot(item, capturedAt, listingLabel);
    if (snap) out.push(snap);
  }
  return out;
}

export function parseListing(
  html: string,
  capturedAt: Date = new Date(),
  listingLabel?: string,
): ProductSnapshot[] {
  return parseProducts(extractProducts(html), capturedAt, listingLabel);
}

async function fetchListingHtml(ctx: AdapterContext, url: string): Promise<string> {
  ctx.signal.throwIfAborted();
  return ctx.http.fetchText(url, ctx.signal, {
    headers: { accept: 'text/html' },
  });
}

async function* discoverListings(): AsyncGenerator<ListingRef, void, void> {
  for (const cat of LISTING_CATEGORIES) {
    yield { url: createListingUrl(cat), externalId: String(cat.itemId) };
  }
}

const adapter: ScraperAdapter = {
  storeSlug: 'golopolis',

  discover: discoverListings,

  async *scrapeCatalog(ctx: AdapterContext): AsyncGenerator<ProductSnapshot, void, void> {
    let yielded = 0;
    let lastError: unknown;

    for (const cat of LISTING_CATEGORIES) {
      try {
        const html = await fetchListingHtml(ctx, createListingUrl(cat));
        const snapshots = parseListing(html, new Date(), cat.label);
        yielded += snapshots.length;
        for (const snap of snapshots) yield snap;
      } catch (err) {
        lastError = err;
        ctx.logger.warn(
          { event: 'adapter.listing.failed', url: createListingUrl(cat), err },
          'listado falló',
        );
      }
    }

    if (yielded === 0 && lastError !== undefined) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
  },

  async scrapeProduct(ref: ListingRef, ctx: AdapterContext): Promise<ProductSnapshot | null> {
    ctx.signal.throwIfAborted();

    const externalId = ref.externalId ?? /itemId=(\d+)/.exec(new URL(ref.url).search)?.[1] ?? null;
    if (externalId === null) return null;
    const detailUrl = /[?&]action=detail/.test(ref.url)
      ? ref.url
      : `${APP_URL}?action=detail&itemId=${encodeURIComponent(externalId)}`;

    const html = await fetchListingHtml(ctx, detailUrl);
    const target = extractProducts(html).find(
      (p) => (str(p.foreign_id) ?? str(p.id)) === externalId,
    );
    return target ? toSnapshot(target, new Date()) : null;
  },
};

export default adapter;
