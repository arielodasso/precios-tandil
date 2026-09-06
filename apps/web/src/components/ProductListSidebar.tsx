'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, ShoppingCart, Trash2, X } from 'lucide-react';
import { useProductList, type ListEntry } from './ProductListContext';
import { cn, formatUnit, titleCase } from '@/lib/utils';
import { formatArs } from './HistoryStrip';
import { ProductImage } from './ProductImage';

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

  if (typeof document === 'undefined') return null;

  const groups = [...groupedByStore].sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative flex h-full w-full max-w-md flex-col bg-yellow-100 text-stone-900 shadow-2xl animate-slide-in-right dark:bg-[#2E2A12] dark:text-[#F2E9C4]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Mi lista"
      >
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b-2 border-yellow-300 px-4 py-3 dark:border-[#56502E]">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-stone-900 text-yellow-100 dark:bg-[#FDEC20] dark:text-[#1F1B07]">
              <ShoppingCart className="size-4" />
            </span>
            <h2 className="text-lg font-bold">Mi lista</h2>
            {items.length > 0 && (
              <span className="rounded-full bg-stone-900 px-2 py-0.5 text-xs font-bold text-yellow-100 dark:bg-[#FDEC20] dark:text-[#1F1B07]">
                {items.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-stone-600 transition-colors hover:bg-yellow-200 hover:text-stone-900 dark:text-[#C9BE90] dark:hover:bg-[#3D3820] dark:hover:text-[#FDEC20]"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Agrupado por fuente elegida */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-600 dark:text-[#B8AE82]">
              Tu lista está vacía. Agregá productos tocando el botón que aparece al lado del precio
              de cada fuente en los listados.
            </p>
          ) : (
            <div className="divide-y divide-yellow-200 dark:divide-[#3B3620]">
              {groups.map((group) => {
                const subtotal = group.entries.reduce((s, e) => s + e.price, 0);
                return (
                  <div key={group.name}>
                    <div className="flex items-center justify-between bg-yellow-200/70 px-4 py-2 dark:bg-[#3D3820]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-[#F2E9C4]">
                          {group.name}
                        </span>
                        <span className="rounded bg-stone-900/10 px-1.5 py-0.5 text-[10px] font-bold text-stone-700 dark:bg-black/20 dark:text-[#C9BE90]">
                          {group.entries.length} {group.entries.length === 1 ? 'item' : 'items'}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-stone-900 dark:text-[#FFE97A]">
                        {formatArs(subtotal)}
                      </span>
                    </div>
                    <ul className="divide-y divide-yellow-200 bg-yellow-100 dark:divide-[#3B3620] dark:bg-[#2E2A12]">
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
          <div className="border-t-2 border-yellow-300 bg-yellow-200/60 px-4 py-3 dark:border-[#56502E] dark:bg-[#3B3620]/60">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-stone-700 dark:text-[#C9BE90]">
                Total de tu lista
              </span>
              <span className="text-lg font-extrabold text-stone-900 dark:text-[#FFE97A]">
                {formatArs(totalSelected)}
              </span>
            </div>
            {savings > 0 && (
              <div className="mt-1.5">
                <p className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-sm font-bold text-white">
                  <ShoppingCart className="size-3.5" />
                  Con Precios Tandil ahorraste {formatArs(savings)}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={clear}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-stone-400/60 px-3 py-1.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-700 hover:text-white dark:border-[#6B633C] dark:text-red-400 dark:hover:bg-red-700 dark:hover:text-white"
            >
              <Trash2 className="size-3.5" />
              Limpiar lista
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
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
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-yellow-300 bg-white/80 dark:border-[#56502E] dark:bg-[#3A3523]">
        <ProductImage src={entry.image_url} alt={titleCase(entry.name)} />
      </div>
      <div className="min-w-0 flex-1">
        {entry.source_url ? (
          <a
            href={entry.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-start gap-1 text-sm font-semibold leading-snug text-stone-800 transition-colors hover:text-yellow-600 dark:text-[#F2E9C4] dark:hover:text-[#FDEC20]"
          >
            <span className="line-clamp-2">{titleCase(entry.name)}</span>
            <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-60" />
          </a>
        ) : (
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{titleCase(entry.name)}</p>
        )}
        <p className="mt-0.5 text-xs text-stone-600 dark:text-[#C9BE90]/80">
          {[entry.brand, entry.unit ? formatUnit(entry.unit) : null].filter(Boolean).join(' · ')}
        </p>
        {best != null && !isBestPick && bestStore && (
          <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            Mejor: {formatArs(best)} en {bestStore}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        <span
          className={cn(
            'whitespace-nowrap text-sm font-bold',
            isBestPick
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-stone-900 dark:text-[#FFE97A]',
          )}
        >
          {formatArs(entry.price)}
        </span>
        <button
          type="button"
          onClick={() => remove(entry.slug, entry.store)}
          className="rounded p-1 text-stone-500 transition-colors hover:bg-red-700 hover:text-white dark:text-[#C9BE90]"
          aria-label={`Quitar ${entry.name} de la lista`}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </li>
  );
}
