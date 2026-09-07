import { getDb } from '@/lib/db';
import { sql } from 'kysely';
import type { KyselyDB } from '@/lib/queries/analytics';
import { getOverview } from '@/lib/queries/analytics';
import { BackButton } from '@/components/BackButton';
import { AutoRefresh } from '@/components/AutoRefresh';
import { titleCase } from '@/lib/utils';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sigma Tecnologías',
  description:
    'Información del proyecto Precios Tandil, integración con Google Analytics y estado interno de la base de precios.',
};

const GA_ID = 'G-XE3FDVCJFE';
const SITE_URL = 'https://precios-tandil.vercel.app';

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

  const today = new Date().toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="py-8">
      <AutoRefresh intervalMs={30000} />
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">Sigma Tecnologías</h1>
        </div>
        <p className="mt-1 text-muted-foreground">
          Información del proyecto, integración con Google Analytics y estado interno del sistema.
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
                Google Analytics
              </dt>
              <dd className="mt-0.5 font-mono text-xs text-muted-foreground">{GA_ID}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            Comparador de precios en supermercados de Tandil: historia de precios por producto,
            oportunidades detectadas y ahorro por canasta. El tráfico se mide con Google Analytics 4
            en todas las páginas del sitio.
          </p>
        </Section>

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
            El snippet de GA4 se inyecta en el <code className="text-alerta">layout</code> raíz del
            sitio, por lo que mide el tráfico de todas las páginas (home, productos, listas y
            comparación de canastas). Los datos se consultan desde el panel de Google Analytics.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            {GA_SNIPPET}
          </pre>
          <p className="mt-3 text-sm text-muted-foreground">
            Para ver métricas de tráfico en tiempo real y por página, entrá al panel.
          </p>
        </Section>
      </div>
    </div>
  );
}
