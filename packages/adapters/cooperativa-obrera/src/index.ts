import type { ProductSnapshot } from '@precios/shared';
import { type AdapterContext, type ListingRef, type ScraperAdapter } from '@precios/scraper-core';

const API_BASE = 'https://api.lacoopeencasa.coop/api';
const WWW_BASE = 'https://www.lacoopeencasa.coop';
const MAX_PAGES_PER_CATEGORY = 400;

const LISTING_CATEGORIES = [
  { categoryId: '2', label: 'Almacén' },
  { categoryId: '3', label: 'Frescos' },
  { categoryId: '4', label: 'Bebidas' },
  { categoryId: '5', label: 'Perfumería' },
  { categoryId: '6', label: 'Limpieza' },
] as const;

interface CoopArticle {
  cod_interno?: string | null;
  descripcion?: string | null;
  marca_desc?: string | null;
  precio?: string | null;
  precio_anterior?: string | null;
  precio_promo?: string | null;
  existe_promo?: string | null;
  precio_unitario?: string | null;
  gramaje?: string | null;
  unimed_desc?: string | null;
  unimed_unitario_desc?: string | null;
  imagen?: string | null;
  categoria_desc?: string | null;
  categoria_inicial_desc?: string | null;
  categoria_secundaria_desc?: string | null;
  categoria_terciaria_desc?: string | null;
}

interface CoopPageResponse {
  estado?: number;
  mensaje?: string | null;
  datos?: {
    articulos?: CoopArticle[];
    cantidad_articulos?: number;
  };
}

function num(v: string | number | null | undefined): number | null {
  const n =
    typeof v === 'string'
      ? Number.parseFloat(v.replace(',', '.'))
      : typeof v === 'number'
        ? v
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function collapse(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function productSlug(description: string): string {
  return description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function unitLabel(article: CoopArticle): string | undefined {
  const amount = num(article.gramaje);
  const unit = collapse(article.unimed_desc);
  if (amount === null || !unit) return undefined;
  const pretty = Number.isInteger(amount) ? String(amount) : String(amount).replace('.', ',');
  return `${pretty} ${unit}`;
}

export function listingBody(categoryId: string, page: number): Record<string, unknown> {
  return {
    id_busqueda: categoryId,
    pagina: page,
    filtros: {
      tipo_seleccion: 'categoria',
      categoria: [],
      marca: [],
      preciomenor: -1,
      preciomayor: -1,
      filtros_gramaje: [],
      filtros_descuento: [],
      cant_articulos: 0,
      ofertas: false,
      modificado: false,
      primer_filtro: '',
    },
  };
}

export function toSnapshot(article: CoopArticle, capturedAt: Date): ProductSnapshot | null {
  const description = collapse(article.descripcion);
  const code = collapse(article.cod_interno);
  if (!description || !code) return null;

  const amount = num(article.precio);
  if (amount === null) return null;

  const promoFlag = collapse(article.existe_promo).toLowerCase();
  const onPromo = promoFlag === '1' || promoFlag === 'true';
  const listOrPromo: 'list' | 'promo' = onPromo ? 'promo' : 'list';

  const cats = [
    article.categoria_inicial_desc,
    article.categoria_secundaria_desc,
    article.categoria_terciaria_desc,
  ]
    .map((c) => collapse(c))
    .filter(Boolean);
  const categoryPath =
    cats.length > 0
      ? cats
      : collapse(article.categoria_desc)
        ? [collapse(article.categoria_desc)!]
        : undefined;

  const unitPrice = num(article.precio_unitario);
  const imageUrl =
    typeof article.imagen === 'string' && article.imagen.startsWith('http')
      ? article.imagen
      : undefined;

  return {
    externalId: code,
    url: `${WWW_BASE}/producto/${productSlug(description)}/${code}`,
    rawDescription: `${description}${unitLabel(article) ? ` ${unitLabel(article)}` : ''}`,
    description: [collapse(article.marca_desc), description, unitLabel(article)]
      .filter(Boolean)
      .join(' '),
    brand: collapse(article.marca_desc) || undefined,
    categoryPath: categoryPath?.map((p) => p.slice(0, 120)),
    unitLabel: unitLabel(article)?.slice(0, 60),
    price: {
      amount,
      listOrPromo,
      ...(unitPrice !== null ? { unitPrice } : {}),
    },
    imageUrl,
    capturedAt: capturedAt.toISOString(),
  };
}

async function* scrapeCategory(
  ctx: AdapterContext,
  categoryId: string,
): AsyncGenerator<ProductSnapshot, void, void> {
  for (let page = 0; page < MAX_PAGES_PER_CATEGORY; page++) {
    ctx.signal.throwIfAborted();
    const payload = await ctx.http.fetchJson<CoopPageResponse>(
      `${API_BASE}/articulos/pagina`,
      ctx.signal,
      { method: 'POST', json: listingBody(categoryId, page) },
    );
    const articles = (payload.datos?.articulos ?? []).filter((a) => a && a.cod_interno);
    if (articles.length === 0) break;
    const capturedAt = new Date();
    for (const article of articles) {
      const snap = toSnapshot(article, capturedAt);
      if (snap) yield snap;
    }
  }
}

async function* discoverListings(): AsyncGenerator<ListingRef, void, void> {
  for (const cat of LISTING_CATEGORIES) {
    yield { url: `${WWW_BASE}/listado/categoria/${cat.categoryId}`, externalId: cat.categoryId };
  }
}

const adapter: ScraperAdapter = {
  storeSlug: 'cooperativa-obrera',

  discover: discoverListings,

  async *scrapeCatalog(ctx: AdapterContext): AsyncGenerator<ProductSnapshot, void, void> {
    let yielded = 0;
    let lastError: unknown;
    for (const cat of LISTING_CATEGORIES) {
      try {
        for await (const snap of scrapeCategory(ctx, cat.categoryId)) {
          yielded++;
          yield snap;
        }
      } catch (err) {
        lastError = err;
        ctx.logger.warn(
          { event: 'adapter.listing.failed', category: cat.categoryId, err },
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
    const externalId = ref.externalId ?? /\/articulo\/(\w+)/.exec(ref.url)?.[1];
    if (!externalId) return null;
    for (const cat of LISTING_CATEGORIES) {
      for await (const snap of scrapeCategory(ctx, cat.categoryId)) {
        if (snap.externalId === externalId) return snap;
      }
    }
    return null;
  },
};

export default adapter;
