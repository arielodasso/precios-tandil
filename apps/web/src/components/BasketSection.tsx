'use client';

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Download, Loader, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BasketRow {
  store_slug: string;
  store_name: string;
  products_count: number;
  products_present: number;
  total_basket: string;
  reference_total: string;
  vs_reference_pct: string;
}

interface BasketProduct {
  slug: string;
  name: string;
  brand: string | null;
  price: number | null;
  ref_price: number;
  is_missing: boolean;
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

export function BasketSection({ basket }: { basket: BasketRow[] }) {
  const [detail, setDetail] = useState<{ store: BasketRow; products: BasketProduct[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function openStore(store: BasketRow) {
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/basket/${store.store_slug}`);
      if (!res.ok) throw new Error('error');
      const data = await res.json();
      setDetail({ store, products: data.products });
    } catch {
      setError('No se pudo cargar la canasta de esta tienda.');
    }
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {basket.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay suficientes datos de canasta por tienda.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {basket.map((b) => {
            const diff = Number(b.vs_reference_pct);
            return (
              <button
                key={b.store_slug}
                type="button"
                onClick={() => void openStore(b)}
                className="rounded-lg border border-border bg-card p-4 text-left text-card-foreground transition-colors hover:border-alerta"
              >
                <p className="text-sm font-bold">{b.store_name}</p>
                <p className="mt-2 text-2xl font-extrabold tracking-tight text-alerta">
                  {formatArs(b.total_basket)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {b.products_present} de {b.products_count} productos de la canasta con precio
                  propio · el resto valuado al promedio
                </p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span
                    className={
                      diff <= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'
                    }
                  >
                    {diff > 0 ? `+${diff}%` : `${diff}%`} vs. promedio
                  </span>
                  <span className="text-muted-foreground" data-capture-exclude="true">
                    Ver canasta →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {detail && (
        <BasketModal
          store={detail.store}
          products={detail.products}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function BasketModal({
  store,
  products,
  onClose,
}: {
  store: BasketRow;
  products: BasketProduct[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      link.download = `canasta-${store.store_slug}.png`;
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
  const present = products.filter((p) => !p.is_missing);
  const missing = products.filter((p) => p.is_missing);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-xl border border-border bg-card text-card-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-lg font-bold">Canasta · {store.store_name}</h3>
            <p className="text-xs text-muted-foreground">
              {products.length} productos comparados · Total {formatArs(store.total_basket)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void download()}
              disabled={busy}
            >
              {busy ? <Loader className="size-4 animate-spin" /> : <Download className="size-4" />}
              {busy ? 'Generando…' : 'Imagen'}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Cerrar"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {error && <p className="px-4 pt-2 text-sm text-red-600">{error}</p>}

        <div
          ref={ref}
          className="max-h-[70vh] overflow-y-auto bg-white"
          style={{ color: '#111827' }}
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-sm font-extrabold">
              Precios <span className="text-alerta">Tandil</span> · Canasta {store.store_name}
            </p>
            <p className="text-xs text-gray-500">{today}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2 text-right">Precio en esta tienda</th>
                <th className="px-4 py-2 text-right">Prom. otras tiendas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {present.map((p) => (
                <tr key={p.slug}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{p.name}</span>
                    {p.brand && <span className="ml-1 text-xs text-gray-500">{p.brand}</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">{formatArs(p.price)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{formatArs(p.ref_price)}</td>
                </tr>
              ))}
              {missing.map((p) => (
                <tr key={p.slug}>
                  <td className="px-4 py-2 text-gray-400">{p.name}</td>
                  <td className="px-4 py-2 text-right text-gray-400">No disponible</td>
                  <td className="px-4 py-2 text-right text-gray-500">{formatArs(p.ref_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {missing.length > 0 && (
            <p className="px-4 py-2 text-xs text-gray-500">
              {missing.length} productos no disponibles en esta tienda se valuaron al promedio.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
