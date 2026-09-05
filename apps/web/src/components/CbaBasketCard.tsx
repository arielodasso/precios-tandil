'use client';

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { ChevronRight, ShoppingBasket, Loader } from 'lucide-react';

interface CbaBasketRow {
  store_slug: string;
  store_name: string;
  products_count: number;
  products_present: number;
  total_basket: string;
  reference_total: string;
  vs_reference_pct: string;
}

interface CbaProduct {
  key: string;
  label: string;
  rubric: string;
  slug: string;
  name: string;
  brand: string | null;
  price: number | null;
  ref_price: number | null;
  is_missing: boolean;
}

interface CbaStoreDetail {
  store_slug: string;
  store_name: string;
  products: CbaProduct[];
}

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

export function CbaBasketCard({
  basket,
  details,
  exportable = false,
}: {
  basket: CbaBasketRow[];
  details: CbaStoreDetail[];
  exportable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cheapest = basket[0] ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!cheapest}
        className="group rounded-lg bg-muted/40 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-alerta hover:bg-muted/60 hover:shadow-md focus-visible:border-alerta focus-visible:outline-none disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        <p className="text-xs text-muted-foreground">Canasta básica más barata</p>
        <p className="text-xl font-bold truncate group-hover:text-alerta">
          {cheapest?.store_name ?? '—'}
        </p>
        {cheapest && (
          <>
            <p className="text-sm text-muted-foreground">{formatArs(cheapest.total_basket)}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <span className="font-medium">Ver detalle</span>
              <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </p>
          </>
        )}
      </button>

      {open && cheapest && (
        <CbaBasketModal
          basket={basket}
          details={details}
          initialSlug={cheapest.store_slug}
          exportable={exportable}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CbaBasketModal({
  basket,
  details,
  initialSlug,
  exportable,
  onClose,
}: {
  basket: CbaBasketRow[];
  details: CbaStoreDetail[];
  initialSlug: string;
  exportable: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState(initialSlug);
  const row = basket.find((b) => b.store_slug === slug) ?? basket[0];
  const detail = details.find((d) => d.store_slug === row?.store_slug);
  const totalItems = basket[0]?.products_count ?? 0;

  const savingsPct = row ? Math.abs(Number(row.vs_reference_pct)) : null;
  const missing = detail?.products.filter((p) => p.is_missing) ?? [];

  async function download(): Promise<void> {
    const el = ref.current;
    if (!el || busy) return;
    setBusy(true);
    setError(null);
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    if (wasDark) root.classList.remove('dark');
    try {
      const dataUrl = await toPng(el, {
        width: el.scrollWidth,
        height: el.scrollHeight,
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = `canasta-${row?.store_slug ?? 'difusion'}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      setError('No se pudo generar la imagen.');
    } finally {
      if (wasDark) root.classList.add('dark');
      setBusy(false);
    }
  }

  const today = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long' }).format(new Date());

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-white text-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div ref={ref} className="bg-white" style={{ color: '#111827' }}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <ShoppingBasket className="size-5 text-alerta" />
              <div>
                <h3 className="text-lg font-bold">Canasta más barata</h3>
                <p className="text-xs text-gray-500">
                  Canasta fija de {totalItems} productos en cada supermercado
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-gray-500">
              <span className="hidden text-xs sm:inline">{today}</span>
              {exportable && (
                <button
                  type="button"
                  onClick={() => void download()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-alerta hover:bg-alerta hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? <Loader className="size-3.5 animate-spin" /> : null}
                  {busy ? 'Generando…' : 'Imagen'}
                </button>
              )}
            </div>
          </div>

          {error && <p className="border-b px-4 pt-2 text-sm text-red-600">{error}</p>}

          {row && (
            <div className="border-b px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-lg font-extrabold text-alerta">{row.store_name}</p>
                <p className="text-2xl font-extrabold tracking-tight">
                  {formatArs(row.total_basket)}
                </p>
                {savingsPct !== null && row.vs_reference_pct !== '0' && (
                  <span
                    className={`text-sm font-semibold ${
                      Number(row.vs_reference_pct) <= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {Number(row.vs_reference_pct) <= 0
                      ? `−${savingsPct}% vs promedio`
                      : `+${savingsPct}% vs promedio`}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {row.products_present} de {row.products_count} productos con precio propio · los que
                no vende se valúan al promedio · precio promedio de las demás tiendas como
                referencia
              </p>
            </div>
          )}

          <div className="border-b px-4 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
              Comparación con las otras tiendas
            </p>
            <div className="flex flex-wrap gap-2">
              {basket.map((b) => {
                const isActive = b.store_slug === row?.store_slug;
                const diff = Number(b.vs_reference_pct);
                return (
                  <button
                    key={b.store_slug}
                    type="button"
                    onClick={() => setSlug(b.store_slug)}
                    className={`rounded-full border px-3 py-1.5 text-left text-xs transition-colors ${
                      isActive
                        ? 'border-alerta bg-alerta font-semibold text-black'
                        : 'border-gray-300 bg-gray-50 hover:border-alerta'
                    }`}
                  >
                    <span className="font-semibold">{b.store_name}</span>{' '}
                    {formatArs(b.total_basket)}
                    {diff <= 0 ? (
                      <span className={isActive ? 'font-semibold' : 'text-emerald-600'}>
                        {' '}
                        (referencia)
                      </span>
                    ) : (
                      <span className={isActive ? 'font-semibold' : 'text-red-600'}> +{diff}%</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-4">
            {!detail || detail.products.length === 0 ? (
              <p className="text-sm text-gray-500">Sin datos de canasta para esta tienda.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
                      <th className="px-2 py-2">Producto</th>
                      <th className="px-2 py-2 text-right">En {row?.store_name}</th>
                      <th className="px-2 py-2 text-right">Prom. otras tiendas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {detail.products.map((p) => (
                      <tr key={p.key}>
                        <td className="px-2 py-2">
                          <span className="font-medium">{p.label}</span>
                          <div className="text-xs text-gray-500">
                            {p.name}
                            {p.brand ? ` · ${p.brand}` : ''}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right font-semibold">
                          {p.is_missing ? (
                            <span className="font-normal text-gray-400">No disponible</span>
                          ) : (
                            formatArs(p.price)
                          )}
                        </td>
                        <td className="px-2 py-2 text-right text-gray-500">
                          {formatArs(p.ref_price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {missing.length > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    {missing.length} productos no disponibles en esta tienda se valuaron al
                    promedio.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
