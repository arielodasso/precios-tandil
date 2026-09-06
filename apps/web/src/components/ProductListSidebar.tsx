'use client';

import { useState } from 'react';
import { ExternalLink, ShoppingCart, Trash2, X } from 'lucide-react';
import { useProductList, type ListEntry } from './ProductListContext';
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
        <ShoppingCart className="size-4" />
        <span className="hidden sm:inline">Mi lista</span>
        {items.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-alerta text-[10px] font-bold text-black">
            {items.length > 99 ? '99+' : items.length}
          </span>
        )}
      </button>
      {open && <ProductListSidebar onClose={() => setOpen(false)} />}
    </>
  );
}

function ProductListSidebar({ onClose }: { onClose: () => void }) {
  const { items, clear, totalSelected, savings, groupedByStore } = useProductList();

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative flex h-full w-full max-w-sm flex-col bg-card shadow-xl animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="size-5 text-alerta" />
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

        {/* Agrupado por fuente elegida */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Tu lista está vacía. Agregá productos tocando el botón que aparece al lado del precio
              de cada fuente en los listados.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {groupedByStore.map((group) => {
                const subtotal = group.entries.reduce((s, e) => s + e.price, 0);
                return (
                  <div key={group.name}>
                    <div className="flex items-center justify-between bg-muted/50 px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {group.name}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {group.entries.length} {group.entries.length === 1 ? 'item' : 'items'}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-primary">{formatArs(subtotal)}</span>
                    </div>
                    <ul className="divide-y divide-border">
                      {group.entries.map((entry) => (
                        <EntryRow key={`${entry.slug}-${entry.store}`} entry={entry} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pie: total + ahorro */}
        {items.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total de tu lista</span>
              <span className="text-lg font-extrabold text-primary">
                {formatArs(totalSelected)}
              </span>
            </div>
            {savings > 0 && (
              <div className="mt-1.5">
                <p className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-sm font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <ShoppingCart className="size-3.5" />
                  Con Precios Tandil ahorraste {formatArs(savings)}
                </p>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full text-destructive hover:text-destructive"
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

function EntryRow({ entry }: { entry: ListEntry }) {
  const { remove } = useProductList();
  const prices = entry.offers.map((o) => o.price).filter((p): p is number => p != null && p > 0);
  const best = prices.length > 0 ? Math.min(...prices) : null;
  const bestStore = best != null ? entry.offers.find((o) => o.price === best)?.store_name : null;
  const isBestPick = best != null && entry.price === best;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        {entry.source_url ? (
          <a
            href={entry.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-start gap-1 line-clamp-2 text-sm font-semibold transition-colors hover:text-alerta"
          >
            {titleCase(entry.name)}
            <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-60" />
          </a>
        ) : (
          <p className="line-clamp-2 text-sm font-semibold">{titleCase(entry.name)}</p>
        )}
        {entry.brand && <p className="text-xs text-muted-foreground">{entry.brand}</p>}
        {entry.unit && (
          <p className="text-[11px] text-muted-foreground/70">{formatUnit(entry.unit)}</p>
        )}
        {best != null && !isBestPick && bestStore && (
          <p className="mt-1 text-[11px] text-emerald-600">
            Mejor: {formatArs(best)} en {bestStore}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className={cn('text-sm font-bold', isBestPick ? 'text-emerald-600' : 'text-primary')}>
          {formatArs(entry.price)}
        </span>
        <button
          type="button"
          onClick={() => remove(entry.slug, entry.store)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          aria-label={`Quitar ${entry.name} de la lista`}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </li>
  );
}
