import {
  cachedCategoryTree,
  cachedPublishedDeals,
  cachedProductHistory,
  cachedProductDetail,
  cachedStoresStatus,
} from './queries/cached';

/**
 * SSR data fetching: queries Neon directly for server-rendered pages.
 * Todos los accesos pasan por functions con unstable_cache para evitar
 * golpear la DB en cada request (Neon free quota).
 * Client components call /api/v1/* Route Handlers instead.
 */
export async function apiFetch<T>(path: string, _revalidateSeconds?: number): Promise<T> {
  if (path.startsWith('/categories')) {
    return { categories: await cachedCategoryTree() } as T;
  }
  if (path.startsWith('/deals')) {
    return { deals: await cachedPublishedDeals() } as T;
  }
  const historyMatch = path.match(/^\/products\/([^/]+)\/history/);
  if (historyMatch) {
    const slug = historyMatch[1];
    const window = new URL(`http://x${path}`).searchParams.get('window') ?? '30';
    return (await cachedProductHistory(slug!, window)) as T;
  }
  const productMatch = path.match(/^\/products\/([^/]+)$/);
  if (productMatch) {
    return (await cachedProductDetail(productMatch[1]!)) as T;
  }
  if (path.startsWith('/stores')) {
    return { stores: await cachedStoresStatus() } as T;
  }

  throw new Error(`apiFetch: ruta no soportada: ${path}`);
}
