import type { ProductSnapshot } from '@precios/shared';
import { type AdapterContext, type ListingRef, type ScraperAdapter } from '@precios/scraper-core';

const BASE_URL = 'https://web.monarcadigital.com.ar';
const MAX_PAGES_PER_CATEGORY = 200;
const PAGE_SIZE = 50;

export interface MonarcaPromotion {
  totalPrice?: string | null;
  unitPrice?: string | null;
  content?: string | null;
  description?: string | null;
  percentageOff?: number | null;
}

export interface MonarcaProduct {
  id: number;
  description?: string | null;
  presentation?: string | null;
  brand?: string | null;
  barcode?: string | null;
  price?: number | null;
  strPrice?: string | null;
  priceByUnity?: number | null;
  promotions?: MonarcaPromotion[] | null;
  category?: { id?: number; description?: string | null } | null;
  featuredImage?: { path?: string | null } | null;
}

export interface MonarcaSearchResponse {
  products?: {
    content?: MonarcaProduct[] | null;
    totalPages?: number | null;
    totalElements?: number | null;
  } | null;
}

export interface MonarcaCategoryNode {
  id: number;
  parentId?: number | null;
  description?: string | null;
  childs?: number[] | null;
}

export interface MonarcaStructResponse {
  categories?: MonarcaCategoryNode[] | null;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function promoAmount(product: MonarcaProduct): {
  amount: number;
  promoLabel?: string;
} | null {
  for (const promo of product.promotions ?? []) {
    if (
      promo.percentageOff !== null &&
      promo.percentageOff !== undefined &&
      promo.percentageOff <= 0
    ) {
      continue;
    }
    const candidate = Number.parseFloat(promo.unitPrice ?? promo.totalPrice ?? '');
    if (!Number.isFinite(candidate) || candidate <= 0) continue;
    return {
      amount: candidate,
      promoLabel: (promo.content ?? promo.description)?.slice(0, 120) ?? undefined,
    };
  }
  return null;
}

export function toSnapshot(
  product: MonarcaProduct,
  capturedAt: Date,
  categoryPath?: string[],
): ProductSnapshot | null {
  const description = product.description ? collapse(product.description) : '';
  if (!description) return null;

  const listPrice =
    typeof product.price === 'number' ? product.price : Number.parseFloat(product.strPrice ?? '');
  if (!Number.isFinite(listPrice) || listPrice <= 0) return null;

  const promo = promoAmount(product);
  const amount = promo?.amount ?? listPrice;

  const ean =
    typeof product.barcode === 'string' && /^\d{13}$/.test(product.barcode.trim())
      ? product.barcode.trim()
      : undefined;

  const imageUrl =
    typeof product.featuredImage?.path === 'string' && product.featuredImage.path.startsWith('http')
      ? product.featuredImage.path
      : undefined;

  const pathFromArg =
    categoryPath && categoryPath.length > 0
      ? categoryPath
      : product.category?.description
        ? [product.category.description]
        : undefined;

  return {
    externalId: String(product.id),
    url: `${BASE_URL}/products/${product.id}`,
    rawDescription: collapse(`${description} ${product.presentation ?? ''}`),
    description: [
      product.brand ? collapse(product.brand) : null,
      description,
      product.presentation ? collapse(product.presentation) : null,
    ]
      .filter(Boolean)
      .join(' '),
    ean,
    brand: product.brand ? collapse(product.brand).slice(0, 120) : undefined,
    categoryPath: pathFromArg?.map((p) => p.slice(0, 120)),
    unitLabel: product.presentation ? collapse(product.presentation).slice(0, 60) : undefined,
    price: {
      amount,
      listOrPromo: promo ? 'promo' : 'list',
      ...(promo?.promoLabel ? { promoLabel: promo.promoLabel } : {}),
      ...(typeof product.priceByUnity === 'number' && product.priceByUnity > 0
        ? { unitPrice: product.priceByUnity }
        : {}),
    },
    imageUrl,
    capturedAt: capturedAt.toISOString(),
  };
}

export function parseSearchResponse(
  payload: unknown,
  capturedAt: Date = new Date(),
  pathsById?: Map<number, string[]>,
): ProductSnapshot[] {
  const content = (payload as MonarcaSearchResponse | null)?.products?.content ?? [];
  const snapshots: ProductSnapshot[] = [];
  for (const item of content) {
    if (!item || typeof item.id !== 'number') continue;
    const snap = toSnapshot(item, capturedAt, pathsById?.get(item.category?.id ?? -1));
    if (snap) snapshots.push(snap);
  }
  return snapshots;
}

async function fetchCategoryPaths(ctx: AdapterContext): Promise<Map<number, string[]> | undefined> {
  try {
    const struct = await ctx.http.fetchJson<MonarcaStructResponse>(
      `${BASE_URL}/api/categories/struct?version=0`,
      ctx.signal,
    );
    const nodes = new Map<number, MonarcaCategoryNode>();
    for (const node of struct.categories ?? []) {
      if (typeof node.id === 'number') nodes.set(node.id, node);
    }
    const paths = new Map<number, string[]>();
    for (const node of nodes.values()) {
      const chain: string[] = [];
      let current: MonarcaCategoryNode | undefined = node;
      for (let depth = 0; current && depth < 10; depth++) {
        if (current.description) chain.unshift(current.description);
        current = current.parentId != null ? nodes.get(current.parentId) : undefined;
      }
      if (chain.length > 0) paths.set(node.id, chain);
    }
    return paths;
  } catch (err) {
    ctx.logger.warn(
      { event: 'adapter.monarca.struct.failed', err },
      'no se pudo resolver el árbol de categorías; se usa la hoja',
    );
    return undefined;
  }
}

function searchUrl(categoryId: string, page: number): string {
  return `${BASE_URL}/api/products/search?page=${page}&query=&size=${PAGE_SIZE}&categoryId=${categoryId}`;
}

interface MonarcaCategoryRef {
  categoryId: string;
  label: string;
}

/** Descubre todas las categorías hoja del árbol de monarca. */
async function fetchMonarcaLeaves(ctx: AdapterContext): Promise<MonarcaCategoryRef[]> {
  const struct = await ctx.http.fetchJson<MonarcaStructResponse>(
    `${BASE_URL}/api/categories/struct?version=0`,
    ctx.signal,
  );
  const leaves: MonarcaCategoryRef[] = [];
  for (const node of struct.categories ?? []) {
    if (typeof node.id !== 'number') continue;
    if ((node.childs?.length ?? 0) === 0) {
      leaves.push({
        categoryId: String(node.id),
        label: node.description ? collapse(node.description) : String(node.id),
      });
    }
  }
  return leaves;
}

async function* discoverListings(ctx: AdapterContext): AsyncGenerator<ListingRef, void, void> {
  const leaves = await fetchMonarcaLeaves(ctx);
  for (const cat of leaves) {
    yield { url: searchUrl(cat.categoryId, 0), externalId: cat.categoryId };
  }
}

const adapter: ScraperAdapter = {
  storeSlug: 'monarca',

  discover: discoverListings,

  async *scrapeCatalog(ctx: AdapterContext): AsyncGenerator<ProductSnapshot, void, void> {
    let yielded = 0;
    let lastError: unknown;
    const paths = await fetchCategoryPaths(ctx);
    const leaves = await fetchMonarcaLeaves(ctx);

    for (const cat of leaves) {
      try {
        for (let page = 0; page < MAX_PAGES_PER_CATEGORY; page++) {
          ctx.signal.throwIfAborted();
          const payload = await ctx.http.fetchJson<MonarcaSearchResponse>(
            searchUrl(cat.categoryId, page),
            ctx.signal,
          );
          const snapshots = parseSearchResponse(payload, new Date(), paths);
          yielded += snapshots.length;
          for (const snap of snapshots) yield snap;

          const totalPages = payload.products?.totalPages ?? 1;
          if (snapshots.length === 0 || page + 1 >= totalPages) break;
        }
      } catch (err) {
        lastError = err;
        ctx.logger.warn(
          { event: 'adapter.listing.failed', url: searchUrl(cat.categoryId, 0), err },
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

    const externalId = ref.externalId ?? /\/products\/(\d+)/.exec(new URL(ref.url).pathname)?.[1];
    if (!externalId) return null;

    const product = await ctx.http.fetchJson<MonarcaProduct>(
      `${BASE_URL}/api/products/${externalId}`,
      ctx.signal,
    );
    return toSnapshot(product, new Date());
  },
};

export default adapter;
