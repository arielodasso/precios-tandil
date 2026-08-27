import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { DealBadge } from './DealBadge';
import { ProductImage } from './ProductImage';
import { formatArs } from './HistoryStrip';
import { cn, titleCase } from '@/lib/utils';

export interface OfferView {
  store: string;
  store_name: string;
  price: number | null;
  is_stale: boolean;
  source_url?: string | null;
}

/**
 * T042 — Tarjeta de comparación: menor precio resaltado en verde con
 * etiqueta textual "Mejor precio", desglose por supermercado y diferencia
 * porcentual contra el mínimo (FR-014). Estados T074: stale, sin ofertas.
 */
export function ProductComparisonCard({
  name,
  brand,
  imageUrl,
  offers,
  dealBadge,
}: {
  name: string;
  brand: string | null;
  imageUrl?: string | null;
  offers: OfferView[];
  dealBadge?: { badge: 'gold' | 'green' } | null;
}) {
  const fresh = offers.filter((o) => !o.is_stale && o.price !== null);
  const prices = fresh.map((o) => o.price as number);
  const min = prices.length > 0 ? Math.min(...prices) : null;

  return (
    <section className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            <ProductImage src={imageUrl ?? null} alt={titleCase(name)} />
          </div>
          <div>
            <h1 className="text-xl font-bold">{titleCase(name)}</h1>
            {brand && <p className="mt-1 text-sm text-muted-foreground">{brand}</p>}
          </div>
        </div>
        {dealBadge && <DealBadge variant={dealBadge.badge} />}
      </div>

      <div className="mt-4">
        {fresh.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este producto no tiene precios actualizados en las últimas tiendas.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {[...fresh]
              .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
              .map((offer) => {
                const isBest = offer.price !== null && offer.price === min;
                const diff =
                  min !== null && offer.price !== null && offer.price > min
                    ? ((offer.price - min) / min) * 100
                    : null;
                return (
                  <li
                    key={offer.store}
                    className={cn(
                      'flex items-center justify-between gap-2 py-3',
                      isBest && 'rounded-md bg-primary px-2 text-primary-foreground',
                    )}
                  >
                    <span>
                      {offer.source_url ? (
                        <a
                          href={offer.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:text-alerta"
                        >
                          {offer.store_name}
                          <ExternalLink className="size-3 opacity-70" />
                        </a>
                      ) : (
                        offer.store_name
                      )}
                      {isBest && (
                        <Badge className="ml-2 bg-alerta text-black hover:bg-alerta-strong">
                          Mejor precio
                        </Badge>
                      )}
                    </span>
                    <span className="text-right">
                      {offer.price !== null && formatArs(offer.price)}
                      {diff !== null && (
                        <span className="ml-1 text-xs opacity-70">(+{diff.toFixed(0)}%)</span>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
        )}

        {offers.some((o) => o.is_stale) && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Algunos supermercados no reportan precios actualizados; sus datos pueden estar
            desactualizados y se muestran aparte del ranking.
          </p>
        )}
      </div>
    </section>
  );
}
