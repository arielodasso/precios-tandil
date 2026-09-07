'use client';

import { ListPlus, ListX } from 'lucide-react';
import { useProductList, type ListEntry } from './ProductListContext';
import { cn } from '@/lib/utils';

/**
 * Botón de agregar/quitar una fuente concreta de un producto. La cantidad la
 * controla el selector de cantidad del producto (card), que se pasa aquí para
 * que al agregar la entrada lleve la cantidad elegida.
 */
export function AddToListButton({
  entry,
  className,
  quantity = 1,
}: {
  entry: Omit<ListEntry, 'added_at'>;
  className?: string;
  quantity?: number;
}) {
  const { add, remove, has } = useProductList();
  const inList = has(entry.slug, entry.store);

  return (
    <button
      type="button"
      onClick={() => (inList ? remove(entry.slug, entry.store) : add({ ...entry, quantity }))}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors',
        inList
          ? 'border-alerta bg-alerta/10 text-alerta hover:bg-alerta/20'
          : 'bg-muted text-muted-foreground hover:border-alerta hover:text-alerta',
        className,
      )}
      aria-label={
        inList
          ? `Quitar ${entry.name} de Mi lista`
          : `Agregar ${entry.name} a Mi lista (${entry.store_name})`
      }
    >
      {inList ? (
        <>
          <ListX className="size-3.5" />
          <span className="hidden sm:inline">Quitar</span>
        </>
      ) : (
        <>
          <ListPlus className="size-3.5" />
          <span className="hidden sm:inline">Agregar</span>
        </>
      )}
    </button>
  );
}
