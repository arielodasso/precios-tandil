'use client';

import { ListPlus, ListX } from 'lucide-react';
import { useProductList, type ListEntry } from './ProductListContext';
import { cn } from '@/lib/utils';

/**
 * Botón de agregar/quitar una fuente concreta de un producto.
 * Cada botón (al lado del precio de una tienda) agrega esa entrada a la lista,
 * guardando el enlace de origen de esa fuente.
 */
export function AddToListButton({
  entry,
  className,
}: {
  entry: Omit<ListEntry, 'added_at'>;
  className?: string;
}) {
  const { add, remove, has } = useProductList();
  const inList = has(entry.slug, entry.store);

  return (
    <button
      type="button"
      onClick={() => (inList ? remove(entry.slug, entry.store) : add(entry))}
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
