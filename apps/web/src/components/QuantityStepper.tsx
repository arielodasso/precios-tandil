'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Selector de cantidad tipo carrito, siempre visible. Permite al usuario
 * indicar cuántas unidades de un producto quiere antes de agregarlo a la lista.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  compact = false,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  compact?: boolean;
  className?: string;
}) {
  const btnCls = cn(
    'flex items-center justify-center text-stone-700 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#F2E9C4] dark:hover:bg-[#3D3820]',
    compact ? 'size-6' : 'size-7',
  );
  return (
    <div
      className={cn(
        'inline-flex items-center divide-x divide-yellow-400/70 rounded-md border border-yellow-400/70 bg-white/70 dark:divide-[#6B633C] dark:border-[#6B633C] dark:bg-black/20',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className={btnCls}
        aria-label="Reducir cantidad"
      >
        <Minus className="size-3.5" />
      </button>
      <span
        className={cn(
          'min-w-0 text-center font-bold tabular-nums text-stone-900 dark:text-[#FFE97A]',
          compact ? 'w-6 text-xs' : 'w-7 text-sm',
        )}
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className={btnCls}
        aria-label="Aumentar cantidad"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
