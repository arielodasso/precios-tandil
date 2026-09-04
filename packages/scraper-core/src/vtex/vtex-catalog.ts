import type { ResilientHttpClient } from '../http/resilient-http-client.ts';
import type { VtexItemRecord } from './vtex-apollo.ts';

/**
 * Catálogo completo de una tienda VTEX usando la Search API pública
 * (`/api/catalog_system/pub/products/search`). Reemplaza al scraping de la
 * caché de Apollo embebida en el HTML, que sólo expone la primera página de
 * cada categoría. Acá descubrimos el árbol completo de categorías hoja y
 * paginamos todas sus páginas.
 */

export interface VtexLeafCategory {
  name: string;
  /** Ruta SEO relativa (sin origin ni barra inicial), p.ej. `almacen/aceites`. */
  relativePath: string;
  /** Ruta canónica de categoría (humana), p.ej. `Almacén/Aceites`. */
  categoryPath: string[];
  url: string;
}

/** Tamaño de página máximo aceptado por la VTEX Search API. */
export const VTEX_PAGE_SIZE = 50;

interface VtexCatalogTreeNode {
  id: number | string;
  name: string;
  url: string;
  hasChildren: boolean;
  children?: VtexCatalogTreeNode[] | null;
}

interface VtexCommertialOffer {
  Price?: number | string | null;
  ListPrice?: number | string | null;
}

interface VtexSearchItem {
  itemId?: string | null;
  nameComplete?: string | null;
  name?: string | null;
  ean?: string | null;
  measurementUnit?: string | null;
  unitMultiplier?: number | string | null;
  images?: Array<{ imageUrl?: string | null }> | null;
  sellers?: Array<{ commertialOffer?: VtexCommertialOffer | null }> | null;
}

interface VtexSearchProduct {
  productId?: string | null;
  productName?: string | null;
  brand?: string | null;
  linkText?: string | null;
  description?: string | null;
  metaTagDescription?: string | null;
  categories?: string[] | null;
  items?: VtexSearchItem[] | null;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function collectLeaves(
  nodes: VtexCatalogTreeNode[] | null | undefined,
  baseUrl: string,
  out: VtexLeafCategory[],
  seen = new Set<string>(),
): void {
  for (const node of nodes ?? []) {
    if (!node || typeof node.name !== 'string' || typeof node.url !== 'string') continue;
    const url = new URL(node.url, baseUrl);
    const relativePath = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!relativePath) continue;
    const hasKids = Array.isArray(node.children) && node.children.length > 0;
    if (hasKids) {
      collectLeaves(node.children, baseUrl, out, seen);
      continue;
    }
    const key = relativePath;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: node.name,
      relativePath,
      categoryPath: node.name
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean),
      url: url.toString(),
    });
  }
}

/** Descubre las categorías hoja de una tienda VTEX. */
export async function fetchVtexLeafCategories(
  baseUrl: string,
  http: ResilientHttpClient,
  signal: AbortSignal,
  allowedRoots?: readonly string[],
): Promise<VtexLeafCategory[]> {
  const tree = await http.fetchJson<VtexCatalogTreeNode[]>(
    `${baseUrl}/api/catalog_system/pub/category/tree/5`,
    signal,
  );
  const leaves: VtexLeafCategory[] = [];
  collectLeaves(tree, baseUrl, leaves);
  if (!allowedRoots || allowedRoots.length === 0) return leaves;
  const allowed = new Set(allowedRoots.map((r) => r.replace(/^\/+|\/+$/g, '').toLowerCase()));
  return leaves.filter(
    (leaf) =>
      allowed.has(leaf.relativePath.split('/')[0]!.toLowerCase()) ||
      allowed.has(leaf.relativePath.toLowerCase()),
  );
}

function clean(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unitLabelFromSku(item: VtexSearchItem): string | null {
  const mu = asStr(item.measurementUnit)?.toLowerCase() ?? null;
  const mult = asNum(item.unitMultiplier) ?? 1;
  if (!mu) return null;
  if (mu === 'un' && mult === 1) return null;
  const prettyMult = Number.isInteger(mult) ? String(mult) : String(mult).replace('.', ',');
  return `${prettyMult} ${mu}`;
}

function offerPrice(item: VtexSearchItem): { amount: number | null; listPrice: number | null } {
  for (const seller of item.sellers ?? []) {
    const offer = seller?.commertialOffer ?? null;
    const amount = asNum(offer?.Price);
    const listPrice = asNum(offer?.ListPrice);
    if (amount !== null && amount > 0) {
      return {
        amount,
        listPrice: listPrice !== null && listPrice >= amount ? listPrice : amount,
      };
    }
  }
  return { amount: null, listPrice: null };
}

/** Mapea un producto de la Search API a un registro normalizado VtexItemRecord. */
export function vtexSearchProductToRecord(
  p: VtexSearchProduct,
  baseUrl: string,
): VtexItemRecord | null {
  const productId = asStr(p.productId) ?? '';
  if (!productId) return null;
  const item = (p.items ?? [])[0];
  if (!item) return null;
  const itemId = asStr(item.itemId);
  if (!itemId) return null;

  const linkText = asStr(p.linkText) ?? productId;
  const name = asStr(item.nameComplete) ?? asStr(item.name) ?? asStr(p.productName);
  if (!name) return null;

  const { amount, listPrice } = offerPrice(item);
  if (amount === null) return null;

  const nameRaw = name;
  const eanRaw = asStr(item.ean) ?? '';
  const ean = /^\d{13}$/.test(eanRaw) ? eanRaw : null;

  const categoriesJson = p.categories ?? [];
  const firstCategory = categoriesJson[0] ?? null;
  const categoryPath =
    typeof firstCategory === 'string'
      ? firstCategory
          .split('/')
          .map((x) => x.trim())
          .filter(Boolean)
      : null;

  const descRaw = asStr(p.description) ?? asStr(p.metaTagDescription) ?? '';
  const description = descRaw ? clean(descRaw).slice(0, 2000) : null;

  const image = (item.images ?? [])[0];
  let imageUrl = asStr(image?.imageUrl) ?? null;
  if (imageUrl?.startsWith('~/')) imageUrl = `${baseUrl}${imageUrl.slice(1)}`;

  const mu = asStr(item.measurementUnit)?.toLowerCase() ?? null;

  return {
    productId,
    itemId,
    ean,
    name: nameRaw,
    description,
    brand: asStr(p.brand) ?? null,
    linkText,
    url: new URL(`/${encodeURIComponent(linkText)}/p`, baseUrl).toString(),
    priceAmount: amount,
    listPriceAmount: listPrice,
    listOrPromo: listPrice !== null && listPrice > amount ? 'promo' : 'list',
    unitLabel: unitLabelFromSku(item),
    measurementUnit: mu,
    unitMultiplier: asNum(item.unitMultiplier),
    imageUrl,
    categoryPath,
  };
}

/**
 * Obtiene una página de productos de una categoría. `from` es inclusivo.
 * Devuelve los registros; una página más corta que `VTEX_PAGE_SIZE` indica
 * que se llegó al final (o `[]` si está fuera de rango).
 */
export async function fetchVtexCategoryPage(
  baseUrl: string,
  relativePath: string,
  from: number,
  http: ResilientHttpClient,
  signal: AbortSignal,
): Promise<VtexItemRecord[]> {
  const to = from + VTEX_PAGE_SIZE - 1;
  const url = `${baseUrl}/api/catalog_system/pub/products/search/${relativePath}?_from=${from}&_to=${to}`;
  const payload = await http.fetchJson<VtexSearchProduct[]>(url, signal);
  const records: VtexItemRecord[] = [];
  for (const product of payload) {
    if (!product) continue;
    const rec = vtexSearchProductToRecord(product, baseUrl);
    if (rec) records.push(rec);
  }
  return records;
}
