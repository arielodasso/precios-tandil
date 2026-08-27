import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { SearchBar } from '@/components/SearchBar';
import { ProductCard } from '@/components/ProductCard';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { CategoryNode } from '@/lib/queries/categories';
import type { DealItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * T044 — Home: búsqueda + chips de categorías (navegables a /categoria/[slug])
 * + sección de oportunidades con los requisitos detectados automáticamente.
 */
export default async function HomePage() {
  let categories: CategoryNode[] = [];
  let deals: DealItem[] = [];
  try {
    const cat = await apiFetch<{ categories: CategoryNode[] }>('/categories', 300);
    categories = cat.categories;
    const d = await apiFetch<{ deals: DealItem[] }>('/deals?status=published');
    deals = d.deals;
  } catch {
    // API caída: la home sigue funcionando con búsqueda
  }

  return (
    <div className="py-8">
      <h1 className="mb-2 text-3xl font-extrabold tracking-tight">¿Dónde conviene comprar hoy?</h1>
      <p className="mb-6 text-muted-foreground">
        Precios comparados entre supermercados de Tandil, actualizados a diario.
      </p>

      <SearchBar />

      <nav aria-label="Categorías" className="mt-7 -mx-4 overflow-x-auto pb-2">
        <ul className="flex gap-2 px-4">
          {categories.length === 0 && (
            <li className="text-sm text-muted-foreground">Categorías no disponibles por ahora.</li>
          )}
          {categories.map((c) => (
            <li key={c.slug}>
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link href={`/categoria/${c.slug}`}>
                  {c.name}
                  <ChevronRight className="size-3" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="top-deals" className="mt-9">
        <div className="mb-4 flex items-center gap-2">
          <h2 id="top-deals" className="text-lg font-bold">
            Oportunidades de la semana
          </h2>
          <Badge className="bg-alerta text-black hover:bg-alerta-strong">Bajos detectados</Badge>
        </div>

        {deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay oportunidades detectadas en este momento. Las publicamos cuando detectamos bajos
            reales contra el promedio de 30 días.
          </p>
        ) : (
          <ul className="grid gap-3">
            {deals.slice(0, 6).map((deal) => (
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
      </section>
    </div>
  );
}
