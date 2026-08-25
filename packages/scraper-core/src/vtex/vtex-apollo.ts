export interface VtexItemRecord {
  productId: string;
  itemId: string;
  ean: string | null;
  name: string;
  brand: string | null;
  linkText: string;
  url: string;
  priceAmount: number;
  listPriceAmount: number | null;
  listOrPromo: 'list' | 'promo';
  unitLabel: string | null;
  measurementUnit: string | null;
  unitMultiplier: number | null;
  imageUrl: string | null;
  categoryPath: string[] | null;
}

export interface ExtractVtexApolloOptions {
  baseUrl: string;
  unitLabelPreference?: Array<'spec' | 'sku'>;
}

type Cache = Record<string, unknown>;
type Json = Record<string, unknown>;

const SKU_KEY_RE = /^Product:(.+?)\.items\([^)]*\)\.\d+$/;
const ROOT_KEY_RE = /^Product:[^$.]+$/;

function asObject(v: unknown): Json | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export function findApolloCache(html: string): Cache | null {
  let best: Cache | null = null;
  let bestSize = -1;
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const raw = match[1] ?? '';
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    const body = raw.slice(start, end + 1);
    try {
      const data = JSON.parse(body) as Cache;
      if (body.length > bestSize && Object.keys(data).some((k) => ROOT_KEY_RE.test(k))) {
        best = data;
        bestSize = body.length;
      }
    } catch {
      continue;
    }
  }
  return best;
}

function resolveRef(cache: Cache, value: unknown, depth = 0): unknown {
  const obj = asObject(value);
  if (!obj || depth > 4) return value;
  if (obj.type === 'id' && typeof obj.id === 'string') {
    const target = cache[obj.id];
    return target === undefined ? undefined : resolveRef(cache, target, depth + 1);
  }
  if (obj.type === 'json' && obj.json !== undefined) return obj.json;
  return value;
}

function resolveAll<T extends Json>(cache: Cache, value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => resolveRef(cache, v)).filter((v): v is T => asObject(v) !== null);
}

function readRange(
  cache: Cache,
  priceRange: unknown,
  kind: 'sellingPrice' | 'listPrice',
): number | null {
  const range = asObject(resolveRef(cache, priceRange));
  const side = asObject(range?.[kind]);
  const low = num(side?.lowPrice);
  const high = num(side?.highPrice);
  if (low !== null && low > 0) return low;
  if (high !== null && high > 0) return high;
  return null;
}

function offerPrices(cache: Cache, sku: Json): { amount: number | null; listPrice: number | null } {
  const sellers = Array.isArray(sku.sellers) ? sku.sellers : [];
  for (const sellerRef of sellers) {
    const seller = asObject(resolveRef(cache, sellerRef));
    const offer = asObject(resolveRef(cache, seller?.commertialOffer));
    const amount = num(offer?.Price);
    const listPrice = num(offer?.ListPrice);
    if (amount !== null && amount > 0) {
      return { amount, listPrice: listPrice !== null && listPrice >= amount ? listPrice : amount };
    }
  }
  return { amount: null, listPrice: null };
}

function unitLabelFromSpec(cache: Cache, root: Json): string | null {
  const groups = resolveAll<Json>(cache, root.specificationGroups);
  for (const group of groups) {
    const specs = resolveAll<Json>(cache, group.specifications);
    for (const spec of specs) {
      if (spec.name === 'UnidaddeMedida') {
        const json = asObject(spec.values)?.json;
        if (Array.isArray(json) && typeof json[0] === 'string') return json[0];
      }
    }
  }
  return null;
}

function unitLabelFromSku(sku: Json): string | null {
  const mu = typeof sku.measurementUnit === 'string' ? sku.measurementUnit.toLowerCase() : null;
  const mult = num(sku.unitMultiplier) ?? 1;
  if (!mu) return null;
  if (mu === 'un' && mult === 1) return null;
  const prettyMult = Number.isInteger(mult) ? String(mult) : String(mult).replace('.', ',');
  return `${prettyMult} ${mu}`;
}

export function extractVtexApolloItems(
  html: string,
  opts: ExtractVtexApolloOptions,
): VtexItemRecord[] {
  const cache = findApolloCache(html);
  if (!cache) return [];

  const records: VtexItemRecord[] = [];
  const seenSku = new Set<string>();
  const preference = opts.unitLabelPreference ?? ['spec', 'sku'];

  for (const key of Object.keys(cache)) {
    const match = SKU_KEY_RE.exec(key);
    if (!match) continue;
    const cacheId = match[1]!;
    const root = asObject(cache[`Product:${cacheId}`]);
    if (!root) continue;

    const sku = asObject(cache[key]);
    if (!sku) continue;
    const itemId = typeof sku.itemId === 'string' ? sku.itemId : null;
    if (!itemId || seenSku.has(itemId)) continue;

    const linkText = typeof root.linkText === 'string' ? root.linkText : cacheId;
    const name =
      (typeof sku.nameComplete === 'string' && sku.nameComplete) ||
      (typeof sku.name === 'string' && sku.name) ||
      (typeof root.productName === 'string' ? root.productName : '');
    if (!name) continue;

    const fromOffer = offerPrices(cache, sku);
    let amount = fromOffer.amount;
    let listPriceAmount = fromOffer.listPrice;
    if (amount === null) {
      amount = readRange(cache, root.priceRange, 'sellingPrice');
      listPriceAmount = listPriceAmount ?? readRange(cache, root.priceRange, 'listPrice');
    }
    if (amount === null) continue;

    const eanRaw = typeof sku.ean === 'string' ? sku.ean.trim() : '';
    const ean = /^\d{13}$/.test(eanRaw) ? eanRaw : null;

    let unitLabel: string | null = null;
    for (const source of preference) {
      unitLabel =
        source === 'spec'
          ? (unitLabelFromSpec(cache, root) ?? unitLabel)
          : (unitLabelFromSku(sku) ?? unitLabel);
      if (unitLabel) break;
    }

    const images = Array.isArray(sku.images) ? sku.images : [];
    const image = asObject(resolveRef(cache, images[0]));
    let imageUrl = typeof image?.imageUrl === 'string' ? image.imageUrl : null;
    if (imageUrl?.startsWith('~/')) imageUrl = `${opts.baseUrl}${imageUrl.slice(1)}`;

    const categoriesJson = asObject(root.categories)?.json;
    const firstCategory = Array.isArray(categoriesJson) ? categoriesJson[0] : null;
    const categoryPath =
      typeof firstCategory === 'string'
        ? firstCategory
            .split('/')
            .map((p) => p.trim())
            .filter(Boolean)
        : null;

    const mu = typeof sku.measurementUnit === 'string' ? sku.measurementUnit.toLowerCase() : null;

    records.push({
      productId: typeof root.productId === 'string' ? root.productId : cacheId,
      itemId,
      ean,
      name,
      brand: typeof root.brand === 'string' && root.brand ? root.brand : null,
      linkText,
      url: new URL(`/${linkText}/p`, opts.baseUrl).toString(),
      priceAmount: amount,
      listPriceAmount,
      listOrPromo: listPriceAmount !== null && listPriceAmount > amount ? 'promo' : 'list',
      unitLabel,
      measurementUnit: mu,
      unitMultiplier: num(sku.unitMultiplier),
      imageUrl,
      categoryPath,
    });
    seenSku.add(itemId);
  }

  return records;
}
