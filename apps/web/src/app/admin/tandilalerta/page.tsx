import Link from 'next/link';
import { getDb } from '@/lib/db';
import {
  getOverview,
  getBiggestDrops,
  getBiggestRises,
  getPriceGaps,
  getCbaBasketByStore,
  getCbaBasketDetail,
  getStoreCompetitiveness,
  getNearHistoricalLow,
  getMostVolatile,
  getTopSavings,
  type KyselyDB,
} from '@/lib/queries/analytics';
import { resolveCbaBasket } from '@/lib/cba';
import { CbaBasketCard } from '@/components/CbaBasketCard';
import { CaptureSection } from '@/components/CaptureSection';
import { BackButton } from '@/components/BackButton';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ProductHistorySearch } from '@/components/ProductHistorySearch';
import { BasketSection } from '@/components/BasketSection';
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

  const cbaItems = await resolveCbaBasket(db);
  const [
    overview,
    drops,
    rises,
    gaps,
    basket,
    cbaDetails,
    competitiveness,
    nearLow,
    volatile,
    topSavings,
  ] = await Promise.all([
    getOverview(db),
    getBiggestDrops(db, 10),
    getBiggestRises(db, 10),
    getPriceGaps(db, 10),
    getCbaBasketByStore(db, cbaItems),
    getCbaBasketDetail(db, cbaItems),
    getStoreCompetitiveness(db),
    getNearHistoricalLow(db, 10),
    getMostVolatile(db, 10),
    getTopSavings(db, 10),
  ]);

  return (
    <div className="py-8">
      <AutoRefresh intervalMs={30000} />
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <BackButton />
          <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">Analíticas</h1>
        </div>
        <p className="mt-1 text-muted-foreground">
          Resumen de precios y tendencias de supermercados de Tandil. Cada sección se puede
          descargar como imagen para compartir.
        </p>
      </div>

      {/* Canasta por tienda (al principio del panel) */}
      <CaptureSection
        title="Canasta por tienda"
        description="Costo de una canasta fija de productos esenciales, valuada en cada supermercado. Los productos que una tienda no vende se valúan al precio promedio. Click en una tienda para ver los productos."
        fileName="precios-tandil-canasta.png"
      >
        <BasketSection basket={basket} />
      </CaptureSection>

      {/* Canasta para difusión (mismo bloque que la home, con exportación) */}
      <CaptureSection
        title="Canasta para difusión"
        description="El mismo detalle de la home: elegí la tienda, armá la comparación y descargala como imagen para difundir."
        fileName="precios-tandil-canasta-detalle.png"
      >
        <CbaBasketCard basket={basket} details={cbaDetails} exportable />
      </CaptureSection>

      {/* Overview */}
      <CaptureSection title="Resumen General" fileName="precios-tandil-resumen.png">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Productos" value={overview.total_products} />
          <StatCard label="Tiendas activas" value={overview.active_stores} />
          <StatCard label="Precios hoy" value={overview.prices_today.toLocaleString('es-AR')} />
        </div>
      </CaptureSection>

      {/* Product History Search */}
      <CaptureSection
        title="Evolución de precio"
        description="Buscá un producto por su slug para ver la evolución histórica de precios."
        fileName="precios-tandil-evolucion.png"
      >
        <ProductHistorySearch />
      </CaptureSection>

      {/* Price Drops */}
      <CaptureSection
        title="Bajadas de la semana"
        description="Productos con mayor descuento contra el promedio de 30 días."
        fileName="precios-tandil-bajadas.png"
      >
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
      </CaptureSection>

      {/* Price Rises */}
      <CaptureSection
        title="Subas de la semana"
        description="Productos con mayor aumento contra el promedio de 30 días."
        fileName="precios-tandil-subas.png"
      >
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
      </CaptureSection>

      {/* Most Volatile Products */}
      <CaptureSection
        title="Mayores variaciones"
        description="Productos con mayor variación de precio (subidas y bajadas) contra el promedio de 30 días."
        fileName="precios-tandil-variaciones.png"
      >
        {volatile.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay suficientes datos de variaciones.</p>
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
                {volatile.map((p) => (
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
      </CaptureSection>

      {/* Top Savings Opportunities */}
      <CaptureSection
        title="Top oportunidades"
        description="Productos con mayor ahorro absoluto: la diferencia entre el mejor precio y el promedio de 30 días."
        fileName="precios-tandil-oportunidades.png"
      >
        {topSavings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay oportunidades significativas detectadas.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Producto</th>
                  <th className="px-4 py-2.5 text-right">Precio hoy</th>
                  <th className="px-4 py-2.5 text-right">Prom. 30d</th>
                  <th className="px-4 py-2.5 text-right">Ahorro</th>
                  <th className="px-4 py-2.5">Mejor tienda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topSavings.map((p) => (
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
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatArs(p.savings_abs)} ({p.savings_pct}%)
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.best_store}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CaptureSection>

      {/* Price Gaps */}
      <CaptureSection
        title="Brechas de precio"
        description="Productos donde más conviene elegir la tienda: mayor diferencia contra el promedio."
        fileName="precios-tandil-brechas.png"
      >
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
      </CaptureSection>

      {/* Store Competitiveness */}
      <CaptureSection
        title="Competitividad por tienda"
        description="Cuántas veces cada tienda tiene el mejor precio entre los productos comparables."
        fileName="precios-tandil-competitividad.png"
      >
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
      </CaptureSection>

      {/* Near Historical Low */}
      <CaptureSection
        title="Cerca del mínimo histórico"
        description="Productos cuyo precio actual está cerca del más bajo registrado en 90 días."
        fileName="precios-tandil-minimo-historico.png"
      >
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
      </CaptureSection>
    </div>
  );
}
