'use client';

import { ListPlus, Minus, Plus, X } from 'lucide-react';
import { useProductList, type ListEntry } from './ProductListContext';
import { cn } from '@/lib/utils';

/**
 * Botón de agregar/quitar una fuente concreta de un producto, con selector
 * de cantidad tipo carrito. Una vez agregado, muestra controles +/- para
 * ajustar la cantidad y un botón para quitarlo.
 */
export function AddToListButton({
  entry,
  className,
}: {
  entry: Omit<ListEntry, 'added_at'>;
  className?: string;
}) {
  const { add, remove, has, setQuantity, items } = useProductList();
  const inList = has(entry.slug, entry.store);

  if (inList) {
    const current = items.find((i) => i.slug === entry.slug && i.store === entry.store);
    const qty = current?.quantity ?? 1;
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-alerta bg-alerta/10 text-alerta',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setQuantity(entry.slug, entry.store, qty - 1)}
          disabled={qty <= 1}
          className="px-1 py-1 transition-colors hover:bg-alerta/20 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Reducir cantidad de ${entry.name}`}
        >
          <Minus className="size-3.5" />
        </button>
        <span className="min-w-[1.5rem] text-center text-xs font-bold" aria-live="polite">
          {qty}
        </span>
        <button
          type="button"
          onClick={() => setQuantity(entry.slug, entry.store, qty + 1)}
          className="px-1 py-1 transition-colors hover:bg-alerta/20"
          aria-label={`Aumentar cantidad de ${entry.name}`}
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => remove(entry.slug, entry.store)}
          className="px-1 py-1 transition-colors hover:bg-red-700 hover:text-white"
          aria-label={`Quitar ${entry.name} de Mi lista`}
          title="Quitar"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        add({
          ...entry,
          quantity: 1,
        })
      }
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors',
        'bg-muted text-muted-foreground hover:border-alerta hover:text-alerta',
        className,
      )}
      aria-label={`Agregar ${entry.name} a Mi lista (${entry.store_name})`}
    >
      <ListPlus className="size-3.5" />
      <span className="hidden sm:inline">Agregar</span>
    </button>
  );
}
