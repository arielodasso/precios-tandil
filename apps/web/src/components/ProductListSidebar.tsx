'use client';

import { useState } from 'react';
import { List, X, Trash2 } from 'lucide-react';
import { useProductList, type ListItem } from './ProductListContext';
import { cn, formatUnit, titleCase } from '@/lib/utils';
import { formatArs } from './HistoryStrip';
import { Button } from '@/components/ui/button';

export function ProductListToggle() {
  const { items } = useProductList();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:border-alerta hover:text-alerta"
        aria-label={`Mi lista (${items.length} productos)`}
      >
        <List className="size-4" />
        <span className="hidden sm:inline">Mi lista</span>
        {items.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-alerta text-[10px] font-bold text-black">
            {items.length}
          </span>
        )}
      </button>
      {open && <ProductListSidebar onClose={() => setOpen(false)} />}
    </>
  );
}

function ProductListSidebar({ onClose }: { onClose: () => void }) {
  const { items, clear, totalBest, savings, groupedByBestStore } = useProductList();

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative flex h-full w-full max-w-sm flex-col bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <List className="size-5 text-alerta" />
            <h2 className="text-lg font-bold">Mi lista</h2>
            {items.length > 0 && (
              <span className="rounded-full bg-alerta/15 px-2 py-0.5 text-xs font-semibold text-alerta">
                {items.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Savings badge */}
        {items.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total tu lista</span>
              <span className="text-lg font-extrabold text-primary">{formatArs(totalBest)}</span>
            </div>
            {savings > 0 && (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Ahorro vs. otras fuentes</span>
                <span className="text-sm font-bold text-emerald-600">
                  {formatArs(savings)} menos
                </span>
              </div>
            )}
          </div>
        )}

        {/* Items grouped by best store */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Tu lista está vacía. Agregá productos desde los listados o el detalle.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {[...groupedByBestStore.entries()].map(([storeName, storeItems]) => (
                <div key={storeName}>
                  <div className="flex items-center gap-2 bg-muted/50 px-4 py-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {storeName}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {storeItems.length} {storeItems.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {storeItems.map((item) => (
                      <ListItemRow key={item.slug} item={item} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-destructive hover:text-destructive"
              onClick={clear}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Limpiar lista
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ListItemRow({ item }: { item: ListItem }) {
  const { remove } = useProductList();
  const bestPrice = item.offers.map((o) => o.price).filter((p): p is number => p != null && p > 0);
  const best = bestPrice.length > 0 ? Math.min(...bestPrice) : null;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-semibold">{titleCase(item.name)}</p>
        {item.brand && <p className="text-xs text-muted-foreground">{item.brand}</p>}
        {item.unit && (
          <p className="text-[11px] text-muted-foreground/70">{formatUnit(item.unit)}</p>
        )}
        {/* Show per-store prices */}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {item.offers
            .filter((o) => o.price != null)
            .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
            .map((o) => {
              const isBest = o.price === best;
              return (
                <span
                  key={o.store}
                  className={cn(
                    'text-[11px]',
                    isBest ? 'font-bold text-emerald-600' : 'text-muted-foreground',
                  )}
                >
                  {o.store_name}: {o.price != null ? formatArs(o.price) : '—'}
                </span>
              );
            })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-sm font-bold text-primary">
          {best != null ? formatArs(best) : '—'}
        </span>
        <button
          type="button"
          onClick={() => remove(item.slug)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          aria-label={`Quitar ${item.name}`}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </li>
  );
}
