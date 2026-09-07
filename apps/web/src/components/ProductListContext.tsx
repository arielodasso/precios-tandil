'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, ListX, Trash2 } from 'lucide-react';
import type { CardOffer, ProductUnit } from '@/lib/types';

/**
 * Entrada de la lista: un producto + la fuente concreta donde se eligió.
 * La lista se agrupa por fuente, y el enlace del título apunta al `source_url`
 * de la fuente seleccionada al agregar.
 */
export interface ListEntry {
  slug: string;
  name: string;
  brand: string | null;
  unit: ProductUnit | null;
  image_url: string | null;
  /** Todas las ofertas del producto (para calcular mejor precio/ahorro). */
  offers: CardOffer[];
  /** Fuente elegida al agregar. */
  store: string;
  store_name: string;
  price: number;
  source_url: string | null;
  /** Cantidad de unidades del producto en la lista (mínimo 1). */
  quantity: number;
  added_at: number;
}

export interface ListStoreGroup {
  name: string;
  entries: ListEntry[];
}

type ToastKind = 'added' | 'removed' | 'cleared';

interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ProductListState {
  items: ListEntry[];
  add: (entry: Omit<ListEntry, 'added_at'>) => void;
  remove: (slug: string, store: string) => void;
  has: (slug: string, store: string) => boolean;
  clear: () => void;
  /** Reemplaza la fuente elegida de una entrada por otra del mismo producto. */
  replace: (slug: string, store: string, next: Omit<ListEntry, 'added_at'>) => void;
  /** Actualiza la cantidad de una entrada (mínimo 1). */
  setQuantity: (slug: string, store: string, quantity: number) => void;
  /** Total si comprás cada producto único a su mejor precio. */
  totalBest: number;
  /** Total si comprás cada producto único al promedio de las otras fuentes. */
  totalAvgOthers: number;
  /** Total de los precios elegidos (suma de las fuentes seleccionadas). */
  totalSelected: number;
  /** Ahorro = avg_others - best (positivo = ahorro al mejor precio). */
  savings: number;
  /** Entradas agrupadas por la fuente seleccionada. */
  groupedByStore: ListStoreGroup[];
  toast: ToastState | null;
}

const LIST_KEY = 'precios-tandil-list';

function readStorage(): ListEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is ListEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as ListEntry).slug === 'string' &&
          typeof (e as ListEntry).store === 'string' &&
          typeof (e as ListEntry).store_name === 'string' &&
          typeof (e as ListEntry).price === 'number' &&
          (e as ListEntry).price > 0 &&
          Array.isArray((e as ListEntry).offers),
      )
      .map((e) => ({ ...e, quantity: e.quantity && e.quantity > 0 ? e.quantity : 1 }));
  } catch {
    return [];
  }
}

function writeStorage(items: ListEntry[]) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(items));
  } catch {
    /* storage full or unavailable */
  }
}

const ProductListContext = createContext<ProductListState | null>(null);

export function ProductListProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ListEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setItems(readStorage());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) writeStorage(items);
  }, [items, mounted]);

  const notify = useCallback((kind: ToastKind, message: string) => {
    setToast({ id: Date.now(), kind, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const add = useCallback(
    (entry: Omit<ListEntry, 'added_at'>) => {
      setItems((prev) => {
        if (prev.some((i) => i.slug === entry.slug && i.store === entry.store)) return prev;
        return [
          ...prev,
          { ...entry, quantity: entry.quantity > 0 ? entry.quantity : 1, added_at: Date.now() },
        ];
      });
      notify('added', `Agregado a Mi lista: ${entry.name}`);
    },
    [notify],
  );

  const remove = useCallback(
    (slug: string, store: string) => {
      const target = items.find((i) => i.slug === slug && i.store === store);
      if (!target) return;
      setItems((prev) => prev.filter((i) => !(i.slug === slug && i.store === store)));
      notify('removed', `Quitado de Mi lista: ${target.name}`);
    },
    [items, notify],
  );

  const has = useCallback(
    (slug: string, store: string) => items.some((i) => i.slug === slug && i.store === store),
    [items],
  );

  const clear = useCallback(() => {
    if (items.length === 0) return;
    setItems([]);
    notify('cleared', 'Mi lista fue vaciada');
  }, [items, notify]);

  const setQuantity = useCallback((slug: string, store: string, quantity: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.slug === slug && i.store === store
          ? { ...i, quantity: Math.max(1, Math.floor(quantity)) }
          : i,
      ),
    );
  }, []);

  const replace = useCallback(
    (slug: string, store: string, next: Omit<ListEntry, 'added_at'>) => {
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.slug === slug && i.store === store);
        if (idx === -1) return prev;
        // Si la fuente nueva ya está en la lista, solo se quita la vieja.
        if (prev.some((i) => i.slug === next.slug && i.store === next.store)) {
          return prev.filter((_, k) => k !== idx);
        }
        const arr = [...prev];
        const existing = arr[idx]!;
        arr[idx] = {
          ...next,
          quantity: next.quantity > 0 ? next.quantity : existing.quantity,
          added_at: Date.now(),
        };
        return arr;
      });
      notify('added', `Fuente cambiada a ${next.store_name}: ${next.name}`);
    },
    [notify],
  );

  const state = useMemo(() => {
    // Ahorro por producto único: usa la unión de sus ofertas.
    const bySlug = new Map<string, ListEntry[]>();
    for (const item of items) {
      const arr = bySlug.get(item.slug) ?? [];
      arr.push(item);
      bySlug.set(item.slug, arr);
    }

    let totalBest = 0;
    let totalAvgOthers = 0;
    let totalSelected = 0;

    const groups = new Map<string, ListStoreGroup>();
    for (const item of items) {
      totalSelected += item.price * item.quantity;
      const key = item.store_name || item.store || 'Otra';
      const group = groups.get(key) ?? { name: key, entries: [] };
      group.entries.push(item);
      groups.set(key, group);
    }

    for (const entries of bySlug.values()) {
      const prices = new Set<number>();
      let totalQty = 0;
      for (const e of entries) {
        totalQty += e.quantity;
        for (const o of e.offers) {
          if (o.price != null && o.price > 0) prices.add(o.price);
        }
      }
      const sorted = [...prices].sort((a, b) => a - b);
      if (sorted.length === 0) continue;
      const best = sorted[0] as number;
      const others = sorted.slice(1);
      const avgOthers =
        others.length > 0 ? others.reduce((s, p) => s + p, 0) / others.length : best;
      totalBest += best * totalQty;
      totalAvgOthers += avgOthers * totalQty;
    }

    return {
      items,
      add,
      remove,
      has,
      clear,
      replace,
      setQuantity,
      totalBest,
      totalAvgOthers,
      totalSelected,
      savings: totalAvgOthers - totalBest,
      groupedByStore: [...groups.values()],
      toast,
    };
  }, [items, add, remove, has, clear, replace, setQuantity, toast]);

  const noop = () => {};

  const toastEl = toast ? (
    <div key={toast.id} className="fixed bottom-4 right-4 z-[120] animate-toast-in">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 shadow-lg">
        {toast.kind === 'added' && <Check className="size-4 shrink-0 text-emerald-600" />}
        {toast.kind === 'removed' && <ListX className="size-4 shrink-0 text-muted-foreground" />}
        {toast.kind === 'cleared' && <Trash2 className="size-4 shrink-0 text-muted-foreground" />}
        <span className="line-clamp-2 max-w-[70vw] text-sm font-medium">{toast.message}</span>
      </div>
    </div>
  ) : null;

  if (!mounted) {
    return (
      <ProductListContext.Provider
        value={{
          items: [],
          add: noop,
          remove: noop,
          has: () => false,
          clear: noop,
          replace: noop,
          setQuantity: noop,
          totalBest: 0,
          totalAvgOthers: 0,
          totalSelected: 0,
          savings: 0,
          groupedByStore: [],
          toast: null,
        }}
      >
        {children}
      </ProductListContext.Provider>
    );
  }

  return (
    <ProductListContext.Provider value={state}>
      {children}
      {toastEl}
    </ProductListContext.Provider>
  );
}

export function useProductList(): ProductListState {
  const ctx = useContext(ProductListContext);
  if (!ctx) throw new Error('useProductList must be used within ProductListProvider');
  return ctx;
}
