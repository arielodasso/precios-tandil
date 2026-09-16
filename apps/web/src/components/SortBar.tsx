'use client';

import Link from 'next/link';
import { ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortOption = 'relevance' | 'az' | 'za' | 'price_asc' | 'price_desc';

const OPTIONS: Array<{ key: SortOption; label: string }> = [
  { key: 'relevance', label: 'Relevancia' },
  { key: 'az', label: 'A-Z' },
  { key: 'za', label: 'Z-A' },
  { key: 'price_asc', label: 'Menor precio' },
  { key: 'price_desc', label: 'Mayor precio' },
];

/**
 * Barra de ordenamiento: A-Z, Z-A, precio menor a mayor y mayor a menor.
 * En modo `href` cada opción es un enlace (paginación del lado del
 * servidor). En modo `onSelect` cambia el orden en el cliente.
 */
export function SortBar({
  current,
  href,
  onSelect,
  className,
}: {
  current: SortOption;
  href?: (sort: SortOption) => string;
  onSelect?: (sort: SortOption) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        '-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0',
        className,
      )}
      role="group"
      aria-label="Ordenar resultados"
    >
      <span className="mr-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
        <ArrowDownWideNarrow className="size-3.5" />
        Ordenar
      </span>
      {OPTIONS.map((opt) => {
        const active = opt.key === current;
        const cls = cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
          active
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground',
        );
        const inner = (
          <>
            {opt.key === 'price_asc' && <ArrowUpWideNarrow className="size-3" />}
            {opt.key === 'price_desc' && <ArrowDownWideNarrow className="size-3" />}
            {opt.label}
          </>
        );
        if (href) {
          return (
            <Link
              key={opt.key}
              href={href(opt.key)}
              aria-current={active ? 'true' : undefined}
              className={cls}
            >
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSelect?.(opt.key)}
            aria-pressed={active}
            className={cls}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
