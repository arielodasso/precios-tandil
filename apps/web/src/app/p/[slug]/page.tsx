import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ProductComparisonCard, type OfferView } from '@/components/ProductComparisonCard';
import { HistoryStrip } from '@/components/HistoryStrip';
import { BackButton } from '@/components/BackButton';
import { apiFetch } from '@/lib/api';
import { siteUrl } from '@/lib/site';
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
  const url = siteUrl(`/p/${slug}`);
  const title = `${product.name}${price !== null && price !== undefined ? ` desde $${price}` : ''}`;
  const description =
    price !== null && price !== undefined
      ? `Mejor precio hoy: $${price} en ${product.summary.stores_count} supermercados de Tandil.`
      : 'Compará este producto en los supermercados de Tandil.';
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      locale: 'es_AR',
      siteName: 'Precios Tandil',
      images: [{ url: `/p/${slug}/opengraph-image`, alt: product.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
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

  const pageUrl = siteUrl(`/p/${product.slug}`);
  const freshOffers = product.offers.filter(
    (o) => !o.is_stale && o.price !== null && o.price !== undefined,
  );

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    brand: product.brand ?? undefined,
    description: `Precios de ${product.name} en supermercados de Tandil.`,
    ...(product.image_url ? { image: [product.image_url] } : {}),
    ...(product.ean !== null ? { gtin13: String(product.ean).padStart(13, '0') } : {}),
    ...(product.summary?.best_price !== null && product.summary?.best_price !== undefined
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'ARS',
            lowPrice: product.summary.best_price,
            highPrice: product.summary.worst_price ?? product.summary.best_price,
            offerCount: product.summary.stores_count,
            offers: freshOffers.map((o) => ({
              '@type': 'Offer',
              priceCurrency: 'ARS',
              price: o.price,
              availability: 'https://schema.org/InStock',
              seller: { '@type': 'Organization', name: o.store_name },
              ...(o.source_url ? { url: o.source_url } : {}),
            })),
          },
        }
      : {}),
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: siteUrl('/') },
      {
        '@type': 'ListItem',
        position: 2,
        name: product.name,
        item: pageUrl,
      },
    ],
  };

  return (
    <div className="py-6">
      <div className="mb-3 flex items-center gap-3">
        <BackButton />
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <ProductComparisonCard
        slug={product.slug}
        name={product.name}
        brand={product.brand}
        unit={product.unit}
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
