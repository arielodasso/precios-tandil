'use client';

import { useState } from 'react';
import { ShoppingBasket, X } from 'lucide-react';

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
}: {
  basket: CbaBasketRow[];
  details: CbaStoreDetail[];
}) {
  const [open, setOpen] = useState(false);
  const cheapest = basket[0] ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!cheapest}
        className="rounded-lg bg-muted/40 p-3 text-left transition-colors hover:border-alerta hover:bg-muted/60 disabled:cursor-default"
      >
        <p className="text-xs text-muted-foreground">Canasta básica más barata</p>
        <p className="text-xl font-bold truncate">{cheapest?.store_name ?? '—'}</p>
        {cheapest && (
          <p className="text-sm text-muted-foreground">
            {formatArs(cheapest.total_basket)}
            {cheapest.vs_reference_pct !== null && (
              <> · {Math.abs(Number(cheapest.vs_reference_pct))}% por debajo del promedio</>
            )}
          </p>
        )}
      </button>

      {open && cheapest && (
        <CbaBasketModal
          basket={basket}
          details={details}
          initialSlug={cheapest.store_slug}
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
  onClose,
}: {
  basket: CbaBasketRow[];
  details: CbaStoreDetail[];
  initialSlug: string;
  onClose: () => void;
}) {
  const [slug, setSlug] = useState(initialSlug);
  const row = basket.find((b) => b.store_slug === slug) ?? basket[0];
  const detail = details.find((d) => d.store_slug === row?.store_slug);
  const totalItems = basket[0]?.products_count ?? 0;

  const savingsPct = row ? Math.abs(Number(row.vs_reference_pct)) : null;
  const missing = detail?.products.filter((p) => p.is_missing) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl rounded-xl border border-border bg-card text-card-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingBasket className="size-5 text-alerta" />
            <div>
              <h3 className="text-lg font-bold">Canasta básica alimentaria</h3>
              <p className="text-xs text-muted-foreground">
                Canasta fija CBA (INDEC) · {totalItems} productos de rubros esenciales
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </div>

        {row && (
          <div className="border-b border-border px-4 py-3">
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
            <p className="mt-1 text-xs text-muted-foreground">
              {row.products_present} de {row.products_count} productos con precio propio · los que
              no vende se valúan al promedio · precio promedio de las demás tiendas como referencia
            </p>
          </div>
        )}

        <div className="border-b border-border px-4 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
                      ? 'border-alerta bg-alerta text-black'
                      : 'border-border bg-muted/40 hover:border-alerta'
                  }`}
                >
                  <span className="font-semibold">{b.store_name}</span> {formatArs(b.total_basket)}
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
            <p className="text-sm text-muted-foreground">Sin datos de canasta para esta tienda.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-2">Producto</th>
                    <th className="px-2 py-2 text-right">En {row?.store_name}</th>
                    <th className="px-2 py-2 text-right">Prom. otras tiendas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.products.map((p) => (
                    <tr key={p.key}>
                      <td className="px-2 py-2">
                        <span className="font-medium">{p.label}</span>
                        <div className="text-xs text-muted-foreground">
                          {p.name}
                          {p.brand ? ` · ${p.brand}` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-semibold">
                        {p.is_missing ? (
                          <span className="font-normal text-muted-foreground">No disponible</span>
                        ) : (
                          formatArs(p.price)
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-muted-foreground">
                        {formatArs(p.ref_price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {missing.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {missing.length} productos no disponibles en esta tienda se valuaron al promedio.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
