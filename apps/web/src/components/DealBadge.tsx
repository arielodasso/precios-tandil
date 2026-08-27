import { badgeVariants } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type DealBadgeVariant = 'gold' | 'green';

/**
 * T061 — Badge de oportunidad con variante gold ("Mejor Oportunidad de la
 * Semana") o green (variación a la baja). FR-015: siempre con texto,
 * nunca solo color. Reduce a un <span> inline (sin div anidado).
 */
export function DealBadge({
  variant = 'green',
  label,
}: {
  variant?: DealBadgeVariant;
  label?: string;
}) {
  const text = label ?? (variant === 'gold' ? 'Mejor Oportunidad de la Semana' : 'Precio bajó');
  return (
    <span
      role="status"
      className={cn(
        badgeVariants({ variant: 'outline' }),
        'whitespace-nowrap bg-transparent',
        variant === 'gold'
          ? 'border-alerta-strong bg-alerta text-black'
          : 'border-emerald-300 bg-emerald-100 text-emerald-800',
      )}
    >
      {text}
    </span>
  );
}
