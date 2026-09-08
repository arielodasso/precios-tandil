import { getDb } from '@/lib/db';
import { sql } from 'kysely';
import type { KyselyDB } from '@/lib/queries/analytics';
import { getOverview } from '@/lib/queries/analytics';
import { getGa4Dashboard } from '@/lib/ga4';
import type { Ga4Metric } from '@/lib/ga4';
import { BackButton } from '@/components/BackButton';
import { AutoRefresh } from '@/components/AutoRefresh';
import { titleCase } from '@/lib/utils';
import { siteUrl } from '@/lib/site';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sigma Tecnologías',
  description:
    'Dashboard de SEO y Google Analytics de Precios Tandil: tráfico, interacción y estado interno.',
};

const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? 'G-7V77W8GP1C';
const SITE_URL = siteUrl('/').replace(/\/$/, '');

const GA_SNIPPET = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_ID}');
</script>`;

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card text-card-foreground">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function MetricGrid({ metrics }: { metrics: Ga4Metric[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {metrics.map((m) => (
        <StatCard key={m.label} label={m.label} value={m.value} sub={m.sub} />
      ))}
    </div>
  );
}

function BarRow({
  name,
  value,
  max,
  suffix,
  href,
}: {
  name: string;
  value: number;
  max: number;
  suffix?: string;
  href?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="w-44 shrink-0 truncate text-sm font-medium text-alerta transition-colors hover:text-alerta-strong"
        >
          {name}
        </a>
      ) : (
        <span className="w-44 shrink-0 truncate text-sm font-medium">{name}</span>
      )}
      <div className="flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-2.5 rounded-full bg-alerta transition-all"
          style={{ width: `${Math.max(1, pct)}%` }}
        />
      </div>
      <span className="w-28 shrink-0 text-right text-sm font-semibold">
        {value.toLocaleString('es-AR')}
        {suffix ? ` ${suffix}` : ''}
      </span>
    </div>
  );
}

export default async function SigmaTecnologiasPage() {
  const db = getDb() as KyselyDB;
  const overview = await getOverview(db);

  const stores = await sql<{
    store_name: string;
    skus: string;
    matched: string;
  }>`
    select s.name as store_name,
           count(ss.id)::int as skus,
           count(ml.product_id)::int as matched
    from store s
    join store_sku ss on ss.store_id = s.id and ss.is_active
    left join match_link ml on ml.store_sku_id = ss.id
    where s.is_active
    group by s.id, s.name
    order by s.name
  `
    .execute(db)
    .then((r) => r.rows);

  const ga = await getGa4Dashboard();

  const trendMax = Math.max(1, ...ga.trend.slice(-14).map((t) => Math.max(t.users, t.sessions)));

  const today = new Date().toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="py-8">
      <AutoRefresh intervalMs={60000} />
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">Sigma Tecnologías</h1>
        </div>
        <p className="mt-1 text-muted-foreground">
          Dashboard de SEO, tráfico e interacción desde Google Analytics 4 y estado interno del
          sistema.
        </p>
      </div>

      <div className="space-y-4">
        <Section title="Información del proyecto">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Proyecto
              </dt>
              <dd className="mt-0.5 font-semibold">Precios Tandil</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                URL
              </dt>
              <dd className="mt-0.5">
                <a
                  href={SITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-alerta transition-colors hover:text-alerta-strong"
                >
                  {SITE_URL}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Desarrollado por
              </dt>
              <dd className="mt-0.5">
                <a
                  href="https://sigmatecnologiasarg.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-alerta transition-colors hover:text-alerta-strong"
                >
                  Sigma Tecnologías
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Google Analytics 4
              </dt>
              <dd className="mt-0.5 font-mono text-xs text-muted-foreground">
                {GA_ID} · propiedad {process.env.GA_PROPERTY_ID ?? '—'}
              </dd>
            </div>
          </dl>
        </Section>

        <Section title="Google Analytics">
          {ga.configured ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-end gap-4">
                <StatCard
                  label="Usuarios ahora"
                  value={
                    ga.realtime.activeUsers !== null
                      ? ga.realtime.activeUsers.toLocaleString('es-AR')
                      : '—'
                  }
                />
                <StatCard
                  label="Eventos ahora"
                  value={
                    ga.realtime.eventCount !== null
                      ? ga.realtime.eventCount.toLocaleString('es-AR')
                      : '—'
                  }
                />
                <div className="text-xs text-muted-foreground">
                  Tiempo real (últimos 30 minutos)
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Últimos 7 días
                </p>
                <MetricGrid metrics={ga.last7} />
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Últimos 30 días
                </p>
                <MetricGrid metrics={ga.last30} />
              </div>

              {ga.trend.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Últimos 14 días (usuarios / sesiones)
                  </p>
                  <div className="space-y-2">
                    {ga.trend.slice(-14).map((t) => (
                      <BarRow
                        key={t.date}
                        name={t.date}
                        value={t.users}
                        max={trendMax}
                        suffix="usuarios"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : ga.error ? (
            <div>
              <p className="text-sm font-semibold text-alerta">
                No se pudo consultar Google Analytics
              </p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{ga.error}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                El snippet (tag {GA_ID}) sigue midiendo el tráfico en todas las páginas; el problema
                es la consulta de datos con la Data API.
              </p>
            </div>
          ) : null}
        </Section>

        {ga.configured && ga.topPages.length > 0 && (
          <Section title="SEO · Páginas más vistas (30 días)">
            <div className="space-y-2">
              {ga.topPages.map((p) => (
                <BarRow
                  key={p.path}
                  name={p.title}
                  value={p.views}
                  max={ga.topPages[0]?.views ?? 1}
                  suffix="vistas"
                  href={`${SITE_URL}${p.path}`}
                />
              ))}
            </div>
          </Section>
        )}

        {ga.configured && ga.channels.length > 0 && (
          <Section title="Adquisición · Canales (30 días)">
            <div className="space-y-2">
              {ga.channels.map((c) => (
                <BarRow
                  key={c.name}
                  name={c.name}
                  value={c.sessions}
                  max={ga.channels[0]?.sessions ?? 1}
                  suffix="sesiones"
                />
              ))}
            </div>
          </Section>
        )}

        {ga.configured && (ga.devices.length > 0 || ga.countries.length > 0) && (
          <Section title="Audiencia · Dispositivos y países (30 días)">
            <div className="space-y-6">
              {ga.devices.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Dispositivos
                  </p>
                  <div className="space-y-2">
                    {ga.devices.map((d) => (
                      <BarRow
                        key={d.name}
                        name={d.name}
                        value={d.sessions}
                        max={ga.devices[0]?.sessions ?? 1}
                        suffix="sesiones"
                      />
                    ))}
                  </div>
                </div>
              )}
              {ga.countries.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Países
                  </p>
                  <div className="space-y-2">
                    {ga.countries.map((c) => (
                      <BarRow
                        key={c.name}
                        name={c.name}
                        value={c.users}
                        max={ga.countries[0]?.users ?? 1}
                        suffix="usuarios"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        <Section title="Estado interno">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Productos" value={overview.total_products} />
            <StatCard label="Tiendas activas" value={overview.active_stores} />
            <StatCard
              label="Precios hoy"
              value={overview.prices_today.toLocaleString('es-AR')}
              sub={today}
            />
          </div>

          <div className="mt-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Cobertura por tienda (SKUs con match)
            </p>
            <div className="mt-3 space-y-2">
              {stores.map((s) => {
                const total = Number(s.skus) || 0;
                const matched = Number(s.matched) || 0;
                const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
                return (
                  <div key={s.store_name} className="flex items-center gap-3">
                    <span className="w-44 shrink-0 text-sm font-medium">
                      {titleCase(String(s.store_name))}
                    </span>
                    <div className="flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-2.5 rounded-full bg-alerta transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-24 text-right text-sm font-semibold">
                      {matched.toLocaleString('es-AR')} / {total.toLocaleString('es-AR')} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        <Section title="Integración Google Analytics">
          <p className="text-sm text-muted-foreground">
            El snippet de GA4 (tag {GA_ID}) se inyecta en el{' '}
            <code className="text-alerta">layout</code> raíz del sitio, por lo que mide el tráfico
            de todas las páginas (home, productos, listas y comparación de canastas). Los datos del
            dashboard se consultan con la Data API de GA4 y el service account configurado.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            {GA_SNIPPET}
          </pre>
        </Section>
      </div>
    </div>
  );
}
