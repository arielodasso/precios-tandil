'use client';

import { useState } from 'react';
import type { HistoryResponse } from '@/lib/types';

function formatArs(v: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v);
}

function Sparkline({ series }: { series: HistoryResponse['series'] }) {
  if (series.length < 2) return null;
  const values = series
    .map((p) => p.min_price)
    .concat(series.map((p) => p.avg_price).filter((v): v is number => v !== null));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const pad = range === 0 ? 1 : Math.max(range * 0.12, 1);
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo || 1;
  const w = 400;
  const h = 80;
  const yFor = (v: number) => h - 4 - ((v - lo) / span) * (h - 8);
  const minPts = series
    .map((p, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${yFor(p.min_price).toFixed(1)}`)
    .join(' ');
  const avgPts = series
    .map((p, i) => {
      if (p.avg_price === null) return null;
      return `${((i / (series.length - 1)) * w).toFixed(1)},${yFor(p.avg_price).toFixed(1)}`;
    })
    .filter((p): p is string => p !== null)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full">
      <line x1="0" y1={h - 4} x2={w} y2={h - 4} stroke="var(--color-border)" strokeWidth="1" />
      <line x1="0" y1="4" x2={w} y2="4" stroke="var(--color-border)" strokeWidth="1" />
      {avgPts && (
        <polyline
          fill="none"
          stroke="var(--color-muted-foreground)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          strokeLinejoin="round"
          points={avgPts}
        />
      )}
      <polyline
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeLinejoin="round"
        points={minPts}
      />
    </svg>
  );
}

export function ProductHistorySearch() {
  const [slug, setSlug] = useState('');
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    const s = slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (!s) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/v1/products/${encodeURIComponent(s)}/history?window=all`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message || `Error ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch {
      setError('Error de red');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="slug del producto (ej. leche-serenisima-1l)"
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-alerta"
        />
        <button
          onClick={search}
          disabled={loading || !slug.trim()}
          className="rounded-lg bg-alerta px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-alerta-strong disabled:opacity-50"
        >
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {data && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold">{data.product_slug}</h4>
            <span className="text-xs text-muted-foreground">
              {data.series.length} días de datos
            </span>
          </div>
          <Sparkline series={data.series} />
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Mín. histórico</dt>
              <dd className="font-semibold">
                {data.series.length > 0
                  ? formatArs(Math.min(...data.series.map((p) => p.min_price)))
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Prom. 30d</dt>
              <dd className="font-semibold">
                {data.stats.avg_30d !== null ? formatArs(data.stats.avg_30d) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Hoy vs 7d</dt>
              <dd className="font-semibold">
                {data.stats.pct_change_7d !== null
                  ? `${data.stats.pct_change_7d > 0 ? '+' : ''}${data.stats.pct_change_7d}%`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Estado</dt>
              <dd className="font-semibold">
                {data.stats.near_min_90d === true ? (
                  <span className="text-emerald-600">Cerca del mínimo</span>
                ) : data.insufficient_history ? (
                  <span className="text-muted-foreground">Datos insuficientes</span>
                ) : (
                  <span className="text-muted-foreground">Normal</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
