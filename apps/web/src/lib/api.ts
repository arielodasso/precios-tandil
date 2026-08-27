import { getDb } from './db';
import { getCategoryTree } from './queries/categories';
import { listPublishedDeals } from './queries/deals';
import { getProductHistory } from './queries/history';
import { getProductDetail } from './queries/products';
import { getStoresStatus } from './queries/stores';

/**
 * SSR data fetching: queries Neon directly for server-rendered pages.
 * Client components call /api/v1/* Route Handlers instead.
 */
export async function apiFetch<T>(path: string, _revalidateSeconds?: number): Promise<T> {
  const db = getDb();

  if (path.startsWith('/categories')) {
    return { categories: await getCategoryTree(db) } as T;
  }
  if (path.startsWith('/deals')) {
    return { deals: await listPublishedDeals(db) } as T;
  }
  const historyMatch = path.match(/^\/products\/([^/]+)\/history/);
  if (historyMatch) {
    const slug = historyMatch[1];
    const window = new URL(`http://x${path}`).searchParams.get('window') ?? '30';
    return (await getProductHistory(db, slug!, window)) as T;
  }
  const productMatch = path.match(/^\/products\/([^/]+)$/);
  if (productMatch) {
    return (await getProductDetail(db, productMatch[1]!)) as T;
  }
  if (path.startsWith('/stores')) {
    return { stores: await getStoresStatus(db) } as T;
  }

  throw new Error(`apiFetch: ruta no soportada: ${path}`);
}
