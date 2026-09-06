'use client';

import { ListPlus, ListX } from 'lucide-react';
import { useProductList, type ListItem } from './ProductListContext';
import { cn } from '@/lib/utils';

export function AddToListButton({
  item,
  className,
}: {
  item: Omit<ListItem, 'added_at'>;
  className?: string;
}) {
  const { add, remove, has } = useProductList();
  const inList = has(item.slug);

  return (
    <button
      type="button"
      onClick={() => (inList ? remove(item.slug) : add(item))}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors',
        inList
          ? 'border-alerta bg-alerta/10 text-alerta hover:bg-alerta/20'
          : 'bg-muted text-muted-foreground hover:border-alerta hover:text-alerta',
        className,
      )}
      aria-label={inList ? 'Quitar de mi lista' : 'Agregar a mi lista'}
    >
      {inList ? (
        <>
          <ListX className="size-3.5" />
          <span className="hidden sm:inline">Quitar</span>
        </>
      ) : (
        <>
          <ListPlus className="size-3.5" />
          <span className="hidden sm:inline">Lista</span>
        </>
      )}
    </button>
  );
}
