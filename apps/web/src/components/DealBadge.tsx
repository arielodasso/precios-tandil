export type DealBadgeVariant = 'gold' | 'green';

/**
 * T061 — Badge de oportunidad con variante gold ("Mejor Oportunidad de la
 * Semana") o green (variación a la baja). FR-015: siempre con texto,
 * nunca solo color.
 */
export function DealBadge({
  variant = 'green',
  label,
}: {
  variant?: DealBadgeVariant;
  label?: string;
}) {
  const text = label ?? (variant === 'gold' ? 'Mejor Oportunidad de la Semana' : 'Precio bajó');
  const styles =
    variant === 'gold'
      ? 'bg-[var(--gold-bg)] text-[var(--gold-text)] border-[var(--gold-text)]'
      : 'bg-transparent text-[var(--accent-strong)] border-[var(--accent)]';
  return (
    <span
      role="status"
      className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${styles}`}
    >
      {text}
    </span>
  );
}
