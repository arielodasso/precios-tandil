import Link from 'next/link';
import { SearchBar } from '@/components/SearchBar';
import { DealBadge } from '@/components/DealBadge';
import { formatArs } from '@/components/HistoryStrip';
import { apiFetch } from '@/lib/api';
import type { DealItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Category {
  slug: string;
  name: string;
}

/**
 * T044 — Home: búsqueda + chips de categorías (scroll-snap) + sección
 * top_deals con badges vigentes.
 */
export default async function HomePage() {
  let categories: Category[] = [];
  let deals: DealItem[] = [];
  try {
    const cat = await apiFetch<{ categories: Category[] }>('/categories', 300);
    categories = cat.categories;
    const d = await apiFetch<{ deals: DealItem[] }>('/deals?status=published');
    deals = d.deals;
  } catch {
    // API caída: la home sigue funcionando con búsqueda y categorías vacías
  }

  return (
    <div className="py-6">
      <h1 className="mb-1 text-2xl font-bold">¿Dónde conviene comprar hoy?</h1>
      <p className="mb-4 text-[var(--muted)]">
        Precios comparados entre supermercados de Tandil, actualizados a diario.
      </p>
      <SearchBar />

      <nav
        aria-label="Categorías"
        className="mt-6 -mx-4 overflow-x-auto pb-2 [scroll-snap-type:x_mandatory]"
      >
        <ul className="flex gap-2 px-4">
          {categories.length === 0 && (
            <li className="text-sm text-[var(--muted)]">Categorías no disponibles por ahora.</li>
          )}
          {categories.map((c) => (
            <li key={c.slug} className="[scroll-snap-align:start]">
              <span className="inline-block whitespace-nowrap rounded-full border border-black/15 px-3 py-1 text-sm dark:border-white/15">
                {c.name}
              </span>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="top-deals" className="mt-8">
        <h2 id="top-deals" className="mb-3 text-lg font-semibold">
          Oportunidades de la semana
        </h2>
        {deals.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No hay oportunidades publicadas en este momento. Las publicamos cuando detectamos bajos
            reales contra el promedio de 30 días.
          </p>
        ) : (
          <ul className="grid gap-3">
            {deals.slice(0, 5).map((deal) => (
              <li key={deal.slug}>
                <Link
                  href={`/p/${deal.slug}`}
                  className="flex items-center justify-between rounded-lg border border-black/10 p-3 hover:border-[var(--accent)] dark:border-white/10"
                >
                  <div>
                    <p className="font-medium">{deal.name}</p>
                    {deal.price !== null && (
                      <p className="text-sm text-[var(--muted)]">
                        {formatArs(deal.price)} · −{deal.discount_pct.toFixed(0)}% vs promedio
                      </p>
                    )}
                  </div>
                  <DealBadge variant={deal.badge === 'gold' ? 'gold' : 'green'} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
