import { DealBadge } from './DealBadge';
import { formatArs } from './HistoryStrip';

export interface OfferView {
  store: string;
  store_name: string;
  price: number | null;
  is_stale: boolean;
}

/**
 * T042 — Tarjeta de comparación: menor precio resaltado en verde con
 * etiqueta textual "Mejor precio", desglose por supermercado y diferencia
 * porcentual contra el mínimo (FR-014). Estados T074: stale, sin ofertas.
 */
export function ProductComparisonCard({
  name,
  brand,
  offers,
  dealBadge,
}: {
  name: string;
  brand: string | null;
  offers: OfferView[];
  dealBadge?: { badge: 'gold' | 'green' } | null;
}) {
  const fresh = offers.filter((o) => !o.is_stale && o.price !== null);
  const prices = fresh.map((o) => o.price as number);
  const min = prices.length > 0 ? Math.min(...prices) : null;

  return (
    <section className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{name}</h1>
          {brand && <p className="text-sm text-[var(--muted)]">{brand}</p>}
        </div>
        {dealBadge && <DealBadge variant={dealBadge.badge} />}
      </div>

      {fresh.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          Este producto no tiene precios actualizados en las últimas tiendas.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-black/5 dark:divide-white/10">
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
                  className={`flex items-center justify-between gap-2 py-3 ${
                    isBest ? 'rounded bg-[var(--accent)]/10 px-2 font-semibold' : ''
                  }`}
                  style={isBest ? { color: 'var(--accent-strong)' } : undefined}
                >
                  <span>
                    {offer.store_name}
                    {isBest && (
                      <span className="ml-2 rounded bg-[var(--accent)] px-2 py-0.5 text-xs font-bold text-white">
                        Mejor precio
                      </span>
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
        <p className="mt-3 rounded bg-black/5 px-3 py-2 text-xs text-[var(--muted)] dark:bg-white/10">
          Algunos supermercados no reportan precios actualizados; sus datos pueden estar
          desactualizados y se muestran aparte del ranking.
        </p>
      )}
    </section>
  );
}
