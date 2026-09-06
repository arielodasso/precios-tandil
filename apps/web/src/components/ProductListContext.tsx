'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CardOffer, ProductUnit } from '@/lib/types';

export interface ListItem {
  slug: string;
  name: string;
  brand: string | null;
  unit: ProductUnit | null;
  image_url: string | null;
  offers: CardOffer[];
  added_at: number;
}

interface ProductListState {
  items: ListItem[];
  add: (item: Omit<ListItem, 'added_at'>) => void;
  remove: (slug: string) => void;
  has: (slug: string) => boolean;
  clear: () => void;
  /** Total if buying each item at its best price. */
  totalBest: number;
  /** Total if buying each item at the average of other (non-best) sources. */
  totalAvgOthers: number;
  /** Savings = avg_others - best (positive = savings). */
  savings: number;
  /** Items grouped by the store that offers the best price. */
  groupedByBestStore: Map<string, ListItem[]>;
}

const LIST_KEY = 'precios-tandil-list';

function readStorage(): ListItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LIST_KEY);
    return raw ? (JSON.parse(raw) as ListItem[]) : [];
  } catch {
    return [];
  }
}

function writeStorage(items: ListItem[]) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(items));
  } catch {
    /* storage full or unavailable */
  }
}

const ProductListContext = createContext<ProductListState | null>(null);

export function ProductListProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setItems(readStorage());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) writeStorage(items);
  }, [items, mounted]);

  const add = useCallback((item: Omit<ListItem, 'added_at'>) => {
    setItems((prev) => {
      if (prev.some((i) => i.slug === item.slug)) return prev;
      return [...prev, { ...item, added_at: Date.now() }];
    });
  }, []);

  const remove = useCallback((slug: string) => {
    setItems((prev) => prev.filter((i) => i.slug !== slug));
  }, []);

  const has = useCallback((slug: string) => items.some((i) => i.slug === slug), [items]);

  const clear = useCallback(() => setItems([]), []);

  const state = useMemo(() => {
    let totalBest = 0;
    let totalAvgOthers = 0;
    const grouped = new Map<string, ListItem[]>();

    for (const item of items) {
      const prices = item.offers.map((o) => o.price).filter((p): p is number => p != null && p > 0);
      const best = prices.length > 0 ? Math.min(...prices) : 0;
      const others = prices.filter((p) => p !== best);
      const avg = others.length > 0 ? others.reduce((s, p) => s + p, 0) / others.length : best;

      totalBest += best;
      totalAvgOthers += avg;

      const bestOffer = item.offers.find((o) => o.price != null && o.price > 0 && o.price === best);
      const bestStore = bestOffer?.store_name ?? 'Otra';
      const list = grouped.get(bestStore) ?? [];
      list.push(item);
      grouped.set(bestStore, list);
    }

    return {
      items,
      add,
      remove,
      has,
      clear,
      totalBest,
      totalAvgOthers,
      savings: totalAvgOthers - totalBest,
      groupedByBestStore: grouped,
    };
  }, [items, add, remove, has, clear]);

  if (!mounted) {
    return (
      <ProductListContext.Provider
        value={{
          items: [],
          add: () => {},
          remove: () => {},
          has: () => false,
          clear: () => {},
          totalBest: 0,
          totalAvgOthers: 0,
          savings: 0,
          groupedByBestStore: new Map(),
        }}
      >
        {children}
      </ProductListContext.Provider>
    );
  }

  return <ProductListContext.Provider value={state}>{children}</ProductListContext.Provider>;
}

export function useProductList(): ProductListState {
  const ctx = useContext(ProductListContext);
  if (!ctx) throw new Error('useProductList must be used within ProductListProvider');
  return ctx;
}
