import Link from 'next/link';
import type { DailyOffersResult } from '@/lib/queries/daily-offers';
import { titleCase } from '@/lib/utils';

const ITEMS_PER_GROUP = 8;

function formatArs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value);
}

export function DailyOffersSection({ result }: { result: DailyOffersResult }) {
  if (result.total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay ofertas vigentes. El bloque se completa con la publicación diaria de ofertas.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {result.total} {result.total === 1 ? 'oferta vigente' : 'ofertas vigentes'} en{' '}
        {result.groups.length} {result.groups.length === 1 ? 'rubro' : 'rubros'}
        {result.window_hours > 24 ? ' (últimos 7 días)' : ' (últimas 24 h)'}.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {result.groups.map((group) => (
          <div key={group.rubro} className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2">
              <h3 className="text-sm font-bold">{group.rubro}</h3>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {group.offers.length}
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {group.offers.slice(0, ITEMS_PER_GROUP).map((offer) => (
                  <tr key={offer.deal_id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link
                        href={`/p/${offer.slug}`}
                        className="font-semibold transition-colors hover:text-alerta"
                      >
                        {titleCase(offer.name)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {offer.store_name ?? 'Sin tienda'}
                        {offer.brand ? ` · ${offer.brand}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <p className="font-bold">{formatArs(offer.best_price)}</p>
                      {offer.avg_30d !== null && offer.avg_30d > 0 && (
                        <p className="text-xs text-muted-foreground line-through">
                          {formatArs(offer.avg_30d)}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        -{offer.discount_pct.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {group.offers.length > ITEMS_PER_GROUP && (
              <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                +{group.offers.length - ITEMS_PER_GROUP} más en {group.rubro}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
