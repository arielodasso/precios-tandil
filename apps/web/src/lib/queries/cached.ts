import { unstable_cache } from 'next/cache';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';
import { getCategoryTree, type CategoryNode } from './categories';
import { listPublishedDeals, listDealsApiRows, type DealPublicItem } from './deals';
import { getProductDetail } from './products';
import { getProductHistory } from './history';
import { getStoresStatus } from './stores';
import { resolveCbaBasket } from '@/lib/cba';
import {
  getOverview,
  getBasketByStore,
  getCbaBasketByStore,
  getCbaBasketDetail,
} from './analytics';
import { getCategorySummary, listCategoryProducts } from './category-products';
import {
  searchPublishedProducts,
  searchApiRows,
  type SearchResults,
  type SearchApiParams,
  type SearchApiRow,
} from './search';
import type { SortOption } from '@/components/SortBar';

const LIST_REVALIDATE = 300;
const DETAIL_REVALIDATE = 600;
const SEARCH_REVALIDATE = 60;

export function cachedCategoryTree(): Promise<CategoryNode[]> {
  return unstable_cache(async () => getCategoryTree(getDb()), ['category-tree'], {
    revalidate: LIST_REVALIDATE,
  })();
}

export function cachedPublishedDeals(): Promise<DealPublicItem[]> {
  return unstable_cache(async () => listPublishedDeals(getDb()), ['published-deals'], {
    revalidate: 180,
  })();
}

export function cachedHomeAnalytics() {
  return unstable_cache(
    async () => {
      const db = getDb();
      const items = await resolveCbaBasket(db);
      const [overview, basket, cbaBasket, cbaDetails] = await Promise.all([
        getOverview(db),
        getBasketByStore(db),
        getCbaBasketByStore(db, items),
        getCbaBasketDetail(db, items),
      ]);
      return { overview, basket, cbaBasket, cbaDetails };
    },
    ['home-analytics'],
    { revalidate: LIST_REVALIDATE },
  )();
}

export function cachedProductDetail(slug: string) {
  return unstable_cache(async (s: string) => getProductDetail(getDb(), s), ['product-detail'], {
    revalidate: DETAIL_REVALIDATE,
  })(slug);
}

export function cachedProductHistory(slug: string, windowRaw: string) {
  return unstable_cache(
    async (s: string, w: string) => getProductHistory(getDb(), s, w),
    ['product-history'],
    { revalidate: DETAIL_REVALIDATE },
  )(slug, windowRaw);
}

export function cachedStoresStatus() {
  return unstable_cache(async () => getStoresStatus(getDb()), ['stores-status'], {
    revalidate: LIST_REVALIDATE,
  })();
}

export function cachedCategorySummary(slug: string) {
  return unstable_cache(async (s: string) => getCategorySummary(getDb(), s), ['category-summary'], {
    revalidate: LIST_REVALIDATE,
  })(slug);
}

export function cachedListCategoryProducts(
  slug: string,
  opts: { page?: number; pageSize?: number; q?: string; sort?: SortOption },
) {
  return unstable_cache(
    async (s: string, o: { page?: number; pageSize?: number; q?: string; sort?: SortOption }) =>
      listCategoryProducts(getDb(), s, o),
    ['category-products'],
    { revalidate: LIST_REVALIDATE },
  )(slug, opts);
}

export function cachedSearch(q: string, page: number, sort: SortOption): Promise<SearchResults> {
  return unstable_cache(
    async (query: string, p: number, s: SortOption) =>
      searchPublishedProducts(getDb(), query, p, s),
    ['search'],
    { revalidate: SEARCH_REVALIDATE },
  )(q, page, sort);
}

export function cachedSearchApi(params: SearchApiParams): Promise<SearchApiRow[]> {
  return unstable_cache(async (p: SearchApiParams) => searchApiRows(getDb(), p), ['search-api'], {
    revalidate: SEARCH_REVALIDATE,
  })(params);
}

export interface DealApiItem {
  slug: string;
  name: string;
  image_url: string | null;
  store_slug: string | null;
  price: number | null;
  discount_pct: number;
  badge: string;
  published_at: string;
  expires_at: string | null;
}

export function cachedDealsApi(): Promise<DealApiItem[]> {
  return unstable_cache(async () => listDealsApiRows(getDb()), ['deals-api'], {
    revalidate: 180,
  })();
}

export async function cachedSavingsTotal(): Promise<{ total: number; contributors: number }> {
  return unstable_cache(
    async () => {
      const db = getDb();
      const result = await sql<{ total: string; contributors: number }>`
        SELECT
          coalesce(round(sum(savings_amount)::numeric, 0), 0)::text as total,
          count(*) FILTER (WHERE device_id <> '__base_total__')::int as contributors
        FROM user_savings
      `.execute(db);
      const row = result.rows[0];
      return {
        total: Number(row?.total ?? 0),
        contributors: Number(row?.contributors ?? 0),
      };
    },
    ['savings-total'],
    { revalidate: 300 },
  )();
}
