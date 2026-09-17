import Link from 'next/link';
import { cn } from '@/lib/utils';

export type SortOption = 'relevance' | 'az' | 'za' | 'price_asc' | 'price_desc';

const OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'az', label: 'A-Z' },
  { value: 'za', label: 'Z-A' },
  { value: 'price_asc', label: 'Precio menor a mayor' },
  { value: 'price_desc', label: 'Precio mayor a menor' },
];

/**
 * Barra de orden para listados. Modo "href": construye links de servidor
 * (categorías y búsqueda). Modo "onSelect": notifica al padre (listados client).
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
  const isLink = typeof href === 'function';
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-xs text-muted-foreground">Ordenar</span>
      {OPTIONS.map((opt) => {
        const active = opt.value === current;
        const selected = 'bg-alerta text-white shadow-sm focus:outline-none';
        const idle =
          'border-border bg-background text-foreground hover:border-alerta hover:text-alerta';
        if (isLink && href) {
          return (
            <Link
              key={opt.value}
              href={href(opt.value)}
              aria-pressed={active}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active ? selected : idle,
              )}
            >
              {opt.label}
            </Link>
          );
        }
        return (
          <button
            key={opt.value}
            type="button"
            onClick={onSelect ? () => onSelect(opt.value) : undefined}
            aria-pressed={active}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              active ? selected : idle,
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
