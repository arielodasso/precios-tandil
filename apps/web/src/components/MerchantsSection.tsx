import { ExternalLink, Mail, MapPin, Phone, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { MerchantsResult, RegisteredMerchant } from '@/lib/queries/merchants';

function formatArs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function MerchantsSection({ result }: { result: MerchantsResult }) {
  const { merchants, error, fetched_at } = result;

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Comercios registrados</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Ficha técnica, productos y ofertas de los comercios publicados en el sitio.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Actualizado: {formatDateTime(fetched_at)}</p>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          No se pudieron actualizar los comercios: {error}
        </p>
      )}

      {merchants.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay comercios registrados para mostrar.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {merchants.map((merchant) => (
            <MerchantCard key={merchant.slug} merchant={merchant} />
          ))}
        </div>
      )}
    </section>
  );
}

function MerchantCard({ merchant }: { merchant: RegisteredMerchant }) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
      <header className="flex items-start gap-3 border-b border-border p-4">
        {merchant.logo_url ? (
          <img
            src={merchant.logo_url}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            className="size-12 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-muted">
            <Store className="size-5 text-muted-foreground" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-bold">{merchant.name}</h3>
            <Badge variant="secondary">{merchant.rubro}</Badge>
            <Badge variant={merchant.offers_allowed ? 'default' : 'outline'}>
              Plan {merchant.plan_name}
            </Badge>
          </div>
          {merchant.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {merchant.description}
            </p>
          )}
        </div>

        <a
          href={merchant.public_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-alerta hover:underline"
        >
          Ver ficha
          <ExternalLink className="size-3" />
        </a>
      </header>

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Ubicación
            </dt>
            <dd className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>
                {merchant.address ?? 'Sin dirección'}
                {merchant.barrio ? ` · ${merchant.barrio}` : ''}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Contacto
            </dt>
            <dd className="space-y-1">
              {merchant.phone ? (
                <a
                  href={phoneHref(merchant.phone)}
                  className="flex items-center gap-1.5 hover:text-alerta"
                >
                  <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                  {merchant.phone}
                </a>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Phone className="size-3.5 shrink-0" />
                  Sin teléfono
                </span>
              )}
              {merchant.email ? (
                <a
                  href={`mailto:${merchant.email}`}
                  className="flex items-center gap-1.5 break-all hover:text-alerta"
                >
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  {merchant.email}
                </a>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Mail className="size-3.5 shrink-0" />
                  Sin email
                </span>
              )}
            </dd>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Categoría
              </dt>
              <dd>{merchant.rubro}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Plan activo
              </dt>
              <dd>{merchant.plan_name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Productos
              </dt>
              <dd>{merchant.product_count}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Última actualización
              </dt>
              <dd>{formatDate(merchant.last_price_update_at)}</dd>
            </div>
          </div>
        </dl>

        <div className="space-y-3">
          <details
            className="rounded-lg border border-border"
            open={merchant.products.length > 0 && merchant.products.length <= 8}
          >
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold hover:bg-muted/40">
              Listado de productos ({merchant.product_count})
            </summary>
            {merchant.products.length === 0 ? (
              <p className="border-t border-border px-3 py-2 text-sm text-muted-foreground">
                Sin productos cargados.
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border">
                {merchant.products.map((product, index) => (
                  <li
                    key={`${product.id ?? product.name}-${index}`}
                    className="flex items-start justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[product.brand, product.presentation].filter(Boolean).join(' · ') ||
                          'Sin marca'}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold">
                      {formatArs(product.price)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>

          {merchant.offers_allowed ? (
            <div className="rounded-lg border border-border">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h4 className="text-sm font-semibold">Ofertas activas</h4>
                <Badge variant="outline">{merchant.offers.length}</Badge>
              </div>
              {merchant.offers.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">Sin ofertas activas.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {merchant.offers.map((offer, index) => (
                    <li
                      key={`${offer.id ?? offer.title}-${index}`}
                      className="flex items-start justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{offer.title}</p>
                        {offer.ends_at && (
                          <p className="text-xs text-muted-foreground">
                            Hasta {formatDate(offer.ends_at)}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {formatArs(offer.offer_price)}
                        </p>
                        {offer.regular_price !== null && (
                          <p className="text-xs text-muted-foreground line-through">
                            {formatArs(offer.regular_price)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              El plan {merchant.plan_name} no incluye sección de ofertas.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
