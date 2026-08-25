import type { HistoryResponse } from '@/lib/types';

/**
 * T054 + T055 — Strip de historial: sparkline SVG ligero (sin librerías),
 * stats de mínimos y badges textuales "Cerca del mínimo histórico" /
 * "+X% esta semana". Regla datos insuficientes (<7 días): aviso textual.
 */
export function HistoryStrip({ history }: { history: HistoryResponse }) {
  const { series, stats, insufficient_history, window } = history;

  if (series.length < 2) {
    return (
      <section
        aria-label="Historial de precio"
        className="mt-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <p className="text-sm text-[var(--muted)]">
          Datos insuficientes: todavía no tenemos suficientes días de historia para este producto.
          Volvé en unos días.
        </p>
      </section>
    );
  }

  const values = series.map((p) => p.min_price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 280;
  const height = 64;
  const points = series
    .map((point, i) => {
      const x = (i / (series.length - 1)) * width;
      const y = height - ((point.min_price - min) / range) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const pctWeek = stats.pct_change_7d;

  return (
    <section
      aria-label={`Historial de precio últimos ${window} días`}
      className="mt-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <h2 className="mb-2 text-sm font-semibold">Historial de precio</h2>
      {insufficient_history && (
        <p className="mb-2 rounded bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
          Datos insuficientes: menos de 7 días de historia; los indicadores son preliminares.
        </p>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-16 w-full"
        role="img"
        aria-label={`Gráfico: mínimo ${formatArs(min)}, máximo ${formatArs(max)}`}
      >
        <polyline
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat
          label={`Mínimo ${window}d`}
          value={stats.min_window !== null ? formatArs(stats.min_window) : '—'}
        />
        <Stat
          label="Promedio 30d"
          value={stats.avg_30d !== null ? formatArs(stats.avg_30d) : '—'}
        />
        <Stat
          label="Mínimo histórico"
          value={
            history.stats.min_window !== null && window === 'all'
              ? formatArs(min)
              : stats.min_window !== null
                ? formatArs(stats.min_window)
                : '—'
          }
        />
        <Stat
          label="Hoy vs 7 días"
          value={pctWeek !== null ? `${pctWeek > 0 ? '+' : ''}${pctWeek}%` : '—'}
          tone={pctWeek === null ? undefined : pctWeek <= 0 ? 'good' : 'bad'}
        />
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {stats.near_min_90d === true && (
          <span
            role="status"
            className="rounded-full border border-[var(--accent)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]"
          >
            Cerca del mínimo histórico
          </span>
        )}
        {pctWeek !== null && pctWeek > 0 && (
          <span
            role="status"
            className="rounded-full border border-red-600 px-3 py-1 text-xs font-semibold text-red-700 dark:text-red-400"
          >
            Subió {pctWeek}% esta semana
          </span>
        )}
        {pctWeek !== null && pctWeek <= 0 && (
          <span
            role="status"
            className="rounded-full border border-[var(--accent)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]"
          >
            Bajó {Math.abs(pctWeek)}% esta semana
          </span>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'var(--accent-strong)' : tone === 'bad' ? '#dc2626' : undefined;
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="font-semibold" style={color ? { color } : undefined}>
        {value}
      </dd>
    </div>
  );
}

export function formatArs(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(value);
}
