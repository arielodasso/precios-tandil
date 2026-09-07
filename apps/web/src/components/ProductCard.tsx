'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { formatArs } from './HistoryStrip';
import { ProductImage } from './ProductImage';
import { AddToListButton } from './AddToListButton';
import { QuantityStepper } from './QuantityStepper';
import { useProductList } from './ProductListContext';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatUnit, titleCase } from '@/lib/utils';
import type { CardOffer, ProductUnit } from '@/lib/types';

export interface ProductCardData {
  slug: string;
  name: string;
  brand?: string | null;
  unit?: ProductUnit | null;
  best_price?: number | null;
  stores_count?: number | null;
  store_slug?: string | null;
  discount_pct?: number;
  image_url?: string | null;
  offers?: CardOffer[];
}

/**
 * T044/T062/T066 — Tarjeta de producto en listados.
 * Selector de cantidad siempre visible debajo del precio; los precios de
 * las fuentes se calculan dinámicamente multiplicando por la cantidad elegida.
 */
export function ProductCard({ product }: { product: ProductCardData }) {
  const {
    slug,
    name,
    brand,
    unit,
    image_url: imageUrl,
    offers,
    discount_pct,
    stores_count,
  } = product;

  const { items, setQuantity } = useProductList();
  const inListEntries = items.filter((i) => i.slug === slug);
  const [qty, setQtyState] = useState(() => inListEntries[0]?.quantity ?? 1);

  const setQty = (next: number) => {
    setQtyState(next);
    if (inListEntries.length > 0) {
      for (const entry of inListEntries) setQuantity(entry.slug, entry.store, next);
    }
  };

  const fallbackBest = product.best_price;
  const sortedOffers =
    offers && offers.length > 0
      ? [...offers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
      : null;
  const bestPrice = sortedOffers?.[0]?.price ?? (sortedOffers ? null : (fallbackBest ?? null));

  const showBest =
    sortedOffers !== null && sortedOffers.length > 0 && sortedOffers[0]!.price != null;

  return (
    <Card className="overflow-hidden transition-all hover:shadow-md">
      <CardContent className="p-0">
        <div className="flex items-start gap-4 p-4 pb-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            <ProductImage src={imageUrl} alt={titleCase(name)} />
          </div>

          <div className="min-w-0 flex-1">
            <Link
              href={`/p/${slug}`}
              className="line-clamp-2 text-base font-bold leading-snug transition-colors hover:text-alerta"
            >
              {titleCase(name)}
            </Link>
            {brand ? <p className="mt-0.5 text-sm text-muted-foreground">{brand}</p> : null}
            {unit && (
              <p className="mt-0.5 text-xs font-medium text-muted-foreground/80">
                {formatUnit(unit)}
              </p>
            )}

            {typeof discount_pct === 'number' && (
              <p className="mt-0.5 text-sm font-semibold text-emerald-600">
                −{discount_pct.toFixed(0)}%
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {showBest && bestPrice != null ? (
              <p
                className="text-lg font-bold leading-none text-primary"
                aria-label={`Mejor precio total: ${formatArs(bestPrice * qty)}`}
              >
                {formatArs(bestPrice * qty)}
              </p>
            ) : null}
            <QuantityStepper compact value={qty} onChange={setQty} />
            {stores_count != null ? (
              <p className="text-xs text-muted-foreground">
                {stores_count} {stores_count === 1 ? 'tienda' : 'tiendas'}
              </p>
            ) : null}
          </div>
        </div>

        {sortedOffers ? (
          <ul className="divide-y divide-border border-t border-border text-sm">
            {sortedOffers.map((offer) => {
              const isBest = offer.price !== null && offer.price === bestPrice;
              return (
                <li
                  key={offer.store}
                  className="flex items-center justify-between gap-2 px-4 py-2.5"
                >
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
                  <span className="flex shrink-0 items-center gap-2">
                    {qty > 1 && <span className="text-[11px] text-muted-foreground">×{qty}</span>}
                    {offer.source_url ? (
                      <a
                        href={offer.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary transition-colors hover:text-alerta"
                      >
                        {offer.price != null ? formatArs(offer.price * qty) : '—'}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="shrink-0 font-semibold">
                        {offer.price != null ? formatArs(offer.price * qty) : '—'}
                      </span>
                    )}
                    {offer.price != null ? (
                      <AddToListButton
                        className="px-1.5 py-1 text-[11px]"
                        quantity={qty}
                        entry={{
                          slug,
                          name,
                          brand: brand ?? null,
                          unit: unit ?? null,
                          image_url: imageUrl ?? null,
                          offers: sortedOffers.map((o) => ({
                            store: o.store,
                            store_name: o.store_name,
                            price: o.price,
                            source_url: o.source_url ?? null,
                          })),
                          store: offer.store,
                          store_name: offer.store_name,
                          price: offer.price,
                          source_url: offer.source_url ?? null,
                          quantity: qty,
                        }}
                      />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
