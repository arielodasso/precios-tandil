import { ProductCard } from '@/components/ProductCard';
import { apiFetch } from '@/lib/api';
import type { DealItem } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Oportunidades detectadas' };

/**
 * T062 — Página /ofertas: listado completo de oportunidades detectadas.
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
      <h1 className="mb-4 text-2xl font-bold">Oportunidades detectadas</h1>
      {deals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay oportunidades detectadas en este momento.
        </p>
      ) : (
        <ul className="grid gap-3">
          {deals.map((deal) => (
            <li key={deal.slug}>
              <ProductCard
                product={{
                  slug: deal.slug,
                  name: deal.name,
                  best_price: deal.price,
                  store_slug: deal.store_slug,
                  discount_pct: deal.discount_pct,
                  image_url: deal.image_url,
                  offers: deal.offers,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
