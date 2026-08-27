import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ProductComparisonCard, type OfferView } from '@/components/ProductComparisonCard';
import { HistoryStrip } from '@/components/HistoryStrip';
import { apiFetch } from '@/lib/api';
import type { HistoryResponse, ProductDetail } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getProduct(slug: string): Promise<ProductDetail | null> {
  try {
    return await apiFetch<ProductDetail>(`/products/${slug}`);
  } catch {
    return null;
  }
}

/**
 * T043 — Página de producto: tarjeta comparativa + historial (pestañas
 * simplificadas: comparación + historial en secuencia), JSON-LD de producto.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: 'Producto no encontrado' };
  const price = product.summary?.best_price;
  return {
    title: `${product.name}${price !== null && price !== undefined ? ` desde $${price}` : ''}`,
    openGraph: {
      title: product.name,
      description:
        price !== null && price !== undefined
          ? `Mejor precio hoy: $${price}. Compará supermercados de Tandil.`
          : 'Compará precios en supermercados de Tandil.',
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  let history: HistoryResponse | null = null;
  try {
    history = await apiFetch<HistoryResponse>(`/products/${slug}/history?window=30`);
  } catch {
    history = null;
  }

  const offers: OfferView[] = product.offers.map((o) => ({
    store: o.store,
    store_name: o.store_name,
    price: o.price,
    is_stale: o.is_stale,
    source_url: o.source_url,
  }));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    brand: product.brand ?? undefined,
    ...(product.ean !== null ? { gtin13: String(product.ean).padStart(13, '0') } : {}),
    ...(product.summary?.best_price !== null && product.summary?.best_price !== undefined
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'ARS',
            lowPrice: product.summary.best_price,
            offerCount: product.summary.stores_count,
          },
        }
      : {}),
  };

  return (
    <div className="py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ProductComparisonCard
        name={product.name}
        brand={product.brand}
        imageUrl={product.image_url}
        offers={offers}
        dealBadge={product.deal_badge ? { badge: product.deal_badge } : null}
      />
      {product.summary?.spread_pct !== null && product.summary?.spread_pct !== undefined && (
        <p className="mt-3 text-sm text-muted-foreground">
          Diferencia entre el más barato y el más caro:{' '}
          <strong className="text-foreground">{product.summary.spread_pct}%</strong>
        </p>
      )}
      {product.stale_notice && (
        <p
          role="status"
          className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          {product.stale_notice}
        </p>
      )}
      {history ? <HistoryStrip history={history} /> : null}
    </div>
  );
}
