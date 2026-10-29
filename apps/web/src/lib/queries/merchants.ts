/**
 * Comercios registrados del sitio público (preciostandil.com).
 *
 * La SPA de Lovable publica el listado y la ficha de cada comercio en su HTML
 * server-side (datos "dehydrated" de TanStack Query), y su API REST bloquea
 * esas tablas con RLS. Por eso leemos la ficha pública y la cacheamos unos
 * minutos para no golpear el sitio en cada refresh del panel.
 */

const DEFAULT_SITE_URL = 'https://preciostandil.com';
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const PLAN_LABELS: Record<string, string> = {
  gratis: 'Gratis',
  comercio: 'Comercio',
  destacada: 'Destacada',
  destacado: 'Destacado',
};

const DEFAULT_OFFERS_PLANS = 'destacada';

export interface MerchantProduct {
  id: number | string | null;
  name: string;
  brand: string | null;
  price: number | null;
  presentation: string | null;
  image_url: string | null;
  price_updated_at: string | null;
}

export interface MerchantOffer {
  id: number | string | null;
  title: string;
  offer_price: number | null;
  regular_price: number | null;
  ends_at: string | null;
  image_url: string | null;
}

export interface RegisteredMerchant {
  slug: string;
  name: string;
  rubro: string;
  description: string | null;
  logo_url: string | null;
  address: string | null;
  barrio: string | null;
  phone: string | null;
  email: string | null;
  plan_slug: string;
  plan_name: string;
  offers_allowed: boolean;
  product_count: number;
  last_price_update_at: string | null;
  products: MerchantProduct[];
  offers: MerchantOffer[];
  public_url: string;
}

export interface MerchantsResult {
  merchants: RegisteredMerchant[];
  error: string | null;
  fetched_at: string;
}

interface DehydratedData {
  queries?: Array<{ state?: { data?: unknown } }>;
}

let cache: { at: number; result: MerchantsResult } | null = null;
let inflight: Promise<RegisteredMerchant[]> | null = null;

/** Base pública configurable (misma que usa el panel para enlazar fichas). */
export function merchantsSiteUrl(path = '/'): string {
  const base = (process.env.MERCHANTS_SITE_URL ?? DEFAULT_SITE_URL).replace(/\/+$/, '');
  if (!path || path === '/') return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Planes habilitados para publicar ofertas (por defecto solo "destacada"). */
export function offersPlans(): Set<string> {
  return new Set(
    (process.env.MERCHANTS_OFFERS_PLANS ?? DEFAULT_OFFERS_PLANS)
      .split(',')
      .map((slug) => slug.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function planLabel(planSlug: string): string {
  const key = planSlug.toLowerCase();
  return PLAN_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export async function getRegisteredMerchants(): Promise<MerchantsResult> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.result;

  if (!inflight) {
    inflight = loadMerchants().finally(() => {
      inflight = null;
    });
  }

  try {
    const merchants = await inflight;
    cache = {
      at: Date.now(),
      result: { merchants, error: null, fetched_at: new Date().toISOString() },
    };
    return cache.result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'No se pudieron leer los comercios registrados.';
    return {
      merchants: cache?.result.merchants ?? [],
      error: message,
      fetched_at: cache?.result.fetched_at ?? new Date().toISOString(),
    };
  }
}

async function loadMerchants(): Promise<RegisteredMerchant[]> {
  const home = await fetchHtml(merchantsSiteUrl('/'));
  const dehydrated = parseDehydrated(home);
  const homeData = asRecord(dehydrated?.queries?.[0]?.state?.data);
  const list = Array.isArray(homeData?.merchants) ? homeData.merchants : null;
  if (!list) throw new Error('El sitio público no devolvió el listado de comercios.');

  const allowed = offersPlans();
  const base = list
    .map((item) => mapMerchantBase(item, allowed))
    .filter((merchant): merchant is RegisteredMerchant => merchant !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const details = await Promise.allSettled(base.map((merchant) => fetchMerchantDetail(merchant)));

  return base.map((merchant, index) => {
    const detail = details[index];
    const extra = detail?.status === 'fulfilled' ? detail.value : null;
    if (!extra) return merchant;
    return {
      ...merchant,
      phone: extra.phone ?? merchant.phone,
      email: extra.email ?? merchant.email,
      products: extra.products,
      offers: extra.offers,
      product_count: extra.products.length > 0 ? extra.products.length : merchant.product_count,
    };
  });
}

async function fetchMerchantDetail(
  merchant: RegisteredMerchant,
): Promise<Pick<RegisteredMerchant, 'phone' | 'email' | 'products' | 'offers'>> {
  const html = await fetchHtml(merchantsSiteUrl(`/comercios/${merchant.slug}`));
  const data = asRecord(parseDehydrated(html)?.queries?.[0]?.state?.data);
  if (!data) throw new Error(`Ficha vacía para ${merchant.slug}`);

  const products = (Array.isArray(data.products) ? data.products : [])
    .map(mapProduct)
    .filter((product): product is MerchantProduct => product !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const offers = (Array.isArray(data.offers) ? data.offers : [])
    .map(mapOffer)
    .filter((offer): offer is MerchantOffer => offer !== null);

  return {
    phone: asString(data.phone),
    email: asString(data.email),
    products,
    offers,
  };
}

function mapMerchantBase(item: unknown, allowedPlans: Set<string>): RegisteredMerchant | null {
  const row = asRecord(item);
  const slug = asString(row?.slug);
  const name = asString(row?.name);
  if (!row || !slug || !name) return null;

  const planSlug = (asString(row.plan_slug) ?? 'gratis').toLowerCase();
  const productCount = asNumber(row.product_count) ?? 0;

  return {
    slug,
    name,
    rubro: asString(row.rubro) ?? 'Otro',
    description: asString(row.description),
    logo_url: asString(row.logo_url),
    address: asString(row.address),
    barrio: asString(row.barrio),
    phone: null,
    email: null,
    plan_slug: planSlug,
    plan_name: planLabel(planSlug),
    offers_allowed: allowedPlans.has(planSlug),
    product_count: productCount,
    last_price_update_at: asString(row.last_price_update_at),
    products: [],
    offers: [],
    public_url: merchantsSiteUrl(`/comercios/${slug}`),
  };
}

function mapProduct(item: unknown): MerchantProduct | null {
  const row = asRecord(item);
  const name = asString(row?.name);
  if (!row || !name) return null;
  return {
    id: asNumber(row.id) ?? asString(row.id),
    name,
    brand: asString(row.brand),
    price: asNumber(row.price),
    presentation: asString(row.presentation),
    image_url: asString(row.image_url),
    price_updated_at: asString(row.price_updated_at),
  };
}

function mapOffer(item: unknown): MerchantOffer | null {
  const row = asRecord(item);
  if (!row) return null;
  const title = asString(row.title) ?? asString(row.name) ?? 'Oferta';
  const offerPrice = asNumber(row.offer_price) ?? asNumber(row.price);
  if (offerPrice === null) return null;
  return {
    id: asNumber(row.id) ?? asString(row.id),
    title,
    offer_price: offerPrice,
    regular_price:
      asNumber(row.regular_price) ?? asNumber(row.list_price) ?? asNumber(row.original_price),
    ends_at: asString(row.ends_at) ?? asString(row.valid_until),
    image_url: asString(row.image_url),
  };
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'user-agent': 'PreciosTandilAdmin/1.0 (+https://preciostandil.com)',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} al leer ${url}`);
  return response.text();
}

function parseDehydrated(html: string): DehydratedData | null {
  const match = html.match(/dehydratedData:\$R\[\d+\]=\{queryState:"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  try {
    const raw = JSON.parse(`"${match[1]}"`) as string;
    return JSON.parse(raw) as DehydratedData;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
