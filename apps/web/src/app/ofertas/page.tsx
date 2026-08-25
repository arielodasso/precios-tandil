import Link from 'next/link';
import { DealBadge } from '@/components/DealBadge';
import { formatArs } from '@/components/HistoryStrip';
import { apiFetch } from '@/lib/api';
import type { DealItem } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ofertas vigentes' };

/**
 * T062 — Página /ofertas: listado completo de oportunidades publicadas.
 */
export default async function OfertasPage() {
  let deals: DealItem[] = [];
  try {
    const res = await apiFetch<{ deals: DealItem[] }>('/deals?status=published');
    deals = res.deals;
  } catch {
    // API caída
  }

  return (
    <div className="py-6">
      <h1 className="mb-4 text-2xl font-bold">Ofertas vigentes</h1>
      {deals.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No hay oportunidades publicadas en este momento.
        </p>
      ) : (
        <ul className="grid gap-3">
          {deals.map((deal) => (
            <li key={deal.slug}>
              <Link
                href={`/p/${deal.slug}`}
                className="flex items-center justify-between rounded-lg border border-black/10 p-3 hover:border-[var(--accent)] dark:border-white/10"
              >
                <div>
                  <p className="font-medium">{deal.name}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {deal.price !== null && formatArs(deal.price)} · −{deal.discount_pct.toFixed(0)}
                    % vs promedio 30 días
                  </p>
                </div>
                <DealBadge variant={deal.badge === 'gold' ? 'gold' : 'green'} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
