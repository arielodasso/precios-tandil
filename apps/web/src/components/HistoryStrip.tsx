import type { HistoryResponse } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * T054 + T055 — Strip de historial: sparkline SVG ligero (sin librerías),
 * stats de mínimos y badges textuales "Cerca del mínimo histórico" /
 * "+X% esta semana". Regla datos insuficientes (<7 días): aviso textual.
 */
export function HistoryStrip({ history }: { history: HistoryResponse }) {
  const { series, stats, insufficient_history, window } = history;

  if (series.length < 2) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Datos insuficientes: todavía no tenemos suficientes días de historia para este producto.
            Volvé en unos días.
          </p>
        </CardContent>
      </Card>
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
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-sm">Historial de precio</CardTitle>
        {insufficient_history && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Datos insuficientes: menos de 7 días de historia; los indicadores son preliminares.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-16 w-full"
          role="img"
          aria-label={`Gráfico: mínimo ${formatArs(min)}, máximo ${formatArs(max)}`}
        >
          <polyline
            fill="none"
            stroke="var(--color-primary)"
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
            <Badge className="border bg-secondary text-secondary-foreground">
              Cerca del mínimo histórico
            </Badge>
          )}
          {pctWeek !== null && pctWeek > 0 && (
            <Badge className="bg-red-100 text-red-700 hover:bg-red-200">
              Subió {pctWeek}% esta semana
            </Badge>
          )}
          {pctWeek !== null && pctWeek <= 0 && (
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200">
              Bajó {Math.abs(pctWeek)}% esta semana
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : undefined;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('font-semibold', color)}>{value}</dd>
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
