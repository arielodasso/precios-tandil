import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { formatArs } from './HistoryStrip';
import { ProductImage } from './ProductImage';
import { Card, CardContent } from '@/components/ui/card';
import { cn, titleCase } from '@/lib/utils';
import type { CardOffer } from '@/lib/types';

export interface ProductCardData {
  slug: string;
  name: string;
  brand?: string | null;
  best_price?: number | null;
  stores_count?: number | null;
  store_slug?: string | null;
  discount_pct?: number;
  image_url?: string | null;
  offers?: CardOffer[];
}

/**
 * T044/T062/T066 — Tarjeta de producto en listados.
 * Muestra imagen, nombre normalizado (capitalizado), y TODOS los precios
 * de las fuentes (no solo el mejor), cada uno con su link de origen.
 */
export function ProductCard({ product }: { product: ProductCardData }) {
  const { slug, name, brand, image_url: imageUrl, offers, discount_pct, stores_count } = product;

  const fallbackBest = product.best_price;
  const sortedOffers =
    offers && offers.length > 0
      ? [...offers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
      : null;
  const bestPrice = sortedOffers?.[0]?.price ?? (sortedOffers ? null : (fallbackBest ?? null));

  const showBest =
    sortedOffers !== null && sortedOffers.length > 0 && sortedOffers[0]!.price != null;

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="p-0">
        <div className="flex items-start gap-4 p-4 pb-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            <ProductImage src={imageUrl} alt={titleCase(name)} />
          </div>

          <div className="min-w-0 flex-1">
            <Link
              href={`/p/${slug}`}
              className="line-clamp-2 text-base font-bold leading-snug text-foreground hover:text-alerta"
            >
              {titleCase(name)}
            </Link>
            {brand ? <p className="mt-0.5 text-sm text-muted-foreground">{brand}</p> : null}

            {typeof discount_pct === 'number' && (
              <p className="mt-0.5 text-sm font-semibold text-emerald-600">
                −{discount_pct.toFixed(0)}%
              </p>
            )}
          </div>

          {showBest && bestPrice != null ? (
            <div className="shrink-0 text-right">
              <p className="text-lg font-bold leading-none text-primary">{formatArs(bestPrice)}</p>
              {stores_count != null ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {stores_count} {stores_count === 1 ? 'tienda' : 'tiendas'}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {sortedOffers ? (
          <ul className="divide-y divide-border border-t border-border text-sm">
            {sortedOffers.map((offer) => {
              const isBest = offer.price !== null && offer.price === bestPrice;
              return (
                <li key={offer.store} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span
                    className={cn(
                      'truncate text-muted-foreground',
                      isBest && 'font-semibold text-foreground',
                    )}
                  >
                    {offer.store_name}
                    {isBest && (
                      <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                        Mejor precio
                      </span>
                    )}
                  </span>
                  {offer.source_url ? (
                    <a
                      href={offer.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary hover:text-alerta"
                    >
                      {offer.price != null ? formatArs(offer.price) : '—'}
                      <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span className="shrink-0 font-semibold">
                      {offer.price != null ? formatArs(offer.price) : '—'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
