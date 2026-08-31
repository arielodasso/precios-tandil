import Link from 'next/link';
import { getDb } from '@/lib/db';
import {
  getOverview,
  getBiggestDrops,
  getBiggestRises,
  getPriceGaps,
  getBasketByStore,
  getStoreCompetitiveness,
  getNearHistoricalLow,
  type KyselyDB,
} from '@/lib/queries/analytics';
import { titleCase } from '@/lib/utils';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Panel de Analíticas',
  description:
    'Panel de análisis de precios de supermercados de Tandil: subas, bajadas, brechas de precio, canasta por tienda.',
};

function formatArs(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);
}

function PctBadge({ value }: { value: number | string | null }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return <span className="text-muted-foreground">—</span>;
  const isGood = n < 0;
  return (
    <span
      className={
        isGood
          ? 'font-semibold text-emerald-600 dark:text-emerald-400'
          : 'font-semibold text-red-600 dark:text-red-400'
      }
    >
      {n > 0 ? '+' : ''}
      {n.toFixed(1)}%
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function AnalyticsPage() {
  const db = getDb() as KyselyDB;

  const [overview, drops, rises, gaps, basket, competitiveness, nearLow] = await Promise.all([
    getOverview(db),
    getBiggestDrops(db, 10),
    getBiggestRises(db, 10),
    getPriceGaps(db, 10),
    getBasketByStore(db),
    getStoreCompetitiveness(db),
    getNearHistoricalLow(db, 10),
  ]);

  return (
    <div className="py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">Analíticas</h1>
        <p className="mt-1 text-muted-foreground">
          Resumen de precios y tendencias de supermercados de Tandil.
        </p>
      </div>

      {/* Overview */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-bold">Resumen General</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Productos" value={overview.total_products} />
          <StatCard label="Tiendas activas" value={overview.active_stores} />
          <StatCard label="Precios hoy" value={overview.prices_today.toLocaleString('es-AR')} />
          <StatCard label="Ofertas activas" value={overview.active_deals} />
        </div>
      </section>

      {/* Price Drops */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-bold">Bajadas de la semana</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Productos con mayor descuento contra el promedio de 30 días.
        </p>
        {drops.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay bajadas significativas detectadas esta semana.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Producto</th>
                  <th className="px-4 py-2.5 text-right">Precio hoy</th>
                  <th className="px-4 py-2.5 text-right">Prom. 30d</th>
                  <th className="px-4 py-2.5 text-right">Cambio</th>
                  <th className="px-4 py-2.5">Tienda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {drops.map((p) => (
                  <tr key={p.slug} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/p/${p.slug}`}
                        className="font-semibold transition-colors hover:text-alerta"
                      >
                        {titleCase(p.name)}
                      </Link>
                      {p.brand && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{p.brand}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold">{formatArs(p.best_price)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {formatArs(p.avg_30d)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <PctBadge value={p.pct_change_7d} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.best_store}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Price Rises */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-bold">Subas de la semana</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Productos con mayor aumento contra el promedio de 30 días.
        </p>
        {rises.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay subas significativas esta semana.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Producto</th>
                  <th className="px-4 py-2.5 text-right">Precio hoy</th>
                  <th className="px-4 py-2.5 text-right">Prom. 30d</th>
                  <th className="px-4 py-2.5 text-right">Cambio</th>
                  <th className="px-4 py-2.5">Tienda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rises.map((p) => (
                  <tr key={p.slug} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/p/${p.slug}`}
                        className="font-semibold transition-colors hover:text-alerta"
                      >
                        {titleCase(p.name)}
                      </Link>
                      {p.brand && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{p.brand}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold">{formatArs(p.best_price)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {formatArs(p.avg_30d)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <PctBadge value={p.pct_change_7d} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.best_store}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Price Gaps */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-bold">Brechas de precio</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Productos donde más conviene elegir la tienda: mayor diferencia contra el promedio.
        </p>
        {gaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay brechas significativas entre tiendas.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Producto</th>
                  <th className="px-4 py-2.5 text-right">Mejor precio</th>
                  <th className="px-4 py-2.5 text-right">Prom. 30d</th>
                  <th className="px-4 py-2.5 text-right">Ahorro</th>
                  <th className="px-4 py-2.5">Mejor tienda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {gaps.map((p) => (
                  <tr key={p.slug} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/p/${p.slug}`}
                        className="font-semibold transition-colors hover:text-alerta"
                      >
                        {titleCase(p.name)}
                      </Link>
                      {p.brand && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{p.brand}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold">{formatArs(p.best_price)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {formatArs(p.avg_30d)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {p.savings_pct}%
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.best_store}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Basket by Store */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-bold">Canasta por tienda</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Costo promedio de la canasta de productos comparables en cada supermercado.
        </p>
        {basket.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay suficientes datos de canasta por tienda.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {basket.map((b) => (
              <div
                key={b.store_slug}
                className="rounded-lg border border-border bg-card p-4 text-card-foreground"
              >
                <p className="text-sm font-bold">{b.store_name}</p>
                <p className="mt-2 text-2xl font-extrabold tracking-tight text-alerta">
                  {formatArs(b.total_basket)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {b.products_count} productos comparables
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Promedio: {formatArs(b.avg_best_price)}</span>
                  <span>Mínimo: {formatArs(b.cheapest_product_price)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Store Competitiveness */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-bold">Competitividad por tienda</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Cuántas veces cada tienda tiene el mejor precio entre los productos comparables.
        </p>
        {competitiveness.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin datos suficientes.</p>
        ) : (
          <div className="space-y-2">
            {competitiveness.map((s) => {
              const total = competitiveness.reduce((a, b) => a + b.best_price_count, 0);
              const pct = total > 0 ? (s.best_price_count / total) * 100 : 0;
              return (
                <div key={s.store_slug} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-sm font-medium">{s.store_name}</span>
                  <div className="flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-2.5 rounded-full bg-alerta transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-sm font-semibold">
                    {s.best_price_count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Near Historical Low */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-bold">Cerca del mínimo histórico</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Productos cuyo precio actual está cerca del más bajo registrado en 90 días.
        </p>
        {nearLow.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay productos cerca del mínimo histórico.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Producto</th>
                  <th className="px-4 py-2.5 text-right">Precio hoy</th>
                  <th className="px-4 py-2.5 text-right">Mín. 90d</th>
                  <th className="px-4 py-2.5">Mejor tienda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {nearLow.map((p) => (
                  <tr key={p.slug} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/p/${p.slug}`}
                        className="font-semibold transition-colors hover:text-alerta"
                      >
                        {titleCase(p.name)}
                      </Link>
                      {p.brand && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{p.brand}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold">{formatArs(p.best_price)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {formatArs(p.min_90d)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.best_store}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
