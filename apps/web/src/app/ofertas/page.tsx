import type { Metadata } from 'next';
import { SortableProductList } from '@/components/SortableProductList';
import type { ProductCardData } from '@/components/ProductCard';
import { BackButton } from '@/components/BackButton';
import { apiFetch } from '@/lib/api';
import { siteUrl } from '@/lib/site';
import type { DealItem } from '@/lib/types';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Oportunidades detectadas',
  description:
    'Aprovechá los descuentos detectados: precios en mínimos de 30 días comparados entre supermercados de Tandil.',
  alternates: { canonical: '/ofertas' },
  openGraph: {
    title: 'Oportunidades detectadas',
    description: 'Descuentos y precios en mínimos de 30 días en supermercados de Tandil.',
    url: siteUrl('/ofertas'),
    type: 'website',
    locale: 'es_AR',
    siteName: 'Precios Tandil',
  },
};

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

  const products: ProductCardData[] = deals.map((deal) => ({
    slug: deal.slug,
    name: deal.name,
    best_price: deal.price,
    store_slug: deal.store_slug,
    discount_pct: deal.discount_pct,
    image_url: deal.image_url,
    offers: deal.offers,
  }));

  const itemListLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Oportunidades detectadas',
    itemListElement: deals.map((d, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: d.name,
      url: siteUrl(`/p/${d.slug}`),
    })),
  };

  return (
    <div className="py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
      <div className="mb-4 flex items-center gap-3">
        <BackButton />
        <h1 className="text-2xl font-bold">Oportunidades detectadas</h1>
      </div>
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay oportunidades detectadas en este momento.
        </p>
      ) : (
        <SortableProductList products={products} defaultSort="relevance" />
      )}
    </div>
  );
}
