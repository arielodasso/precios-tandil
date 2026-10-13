# Precios Tandil — Spec de migración a Lovable + Supabase

> **Estado / decisión (actualizado):** se descartó crear un Supabase propio
> (§1–§3 de este doc). La SPA de Lovable ya vive en
> `github.com/arielodasso/perfect-pixel-replica` (TanStack Start + Supabase JS,
> esquema en `drizzle/migrations/`) sobre **Lovable Cloud**, cuyas tablas planas
> (`stores, categories, products, offers, price_history, deals, cba_items,
user_savings`) son un superconjunto 1:1 de las nuestras. El entregable es:
> (a) **cargar los datos reales** ahí (`db/seed/real_data.sql`, generado por
> `scripts/lovable-export.mjs`) y (b) **replicar la ingesta diaria automática**
> en el sitio (§7). Las secciones de schema/views/rpc de abajo quedan como
> referencia del camino no elegido.

> Objetivo: reemplazar `apps/web` (Next.js SSR sobre Neon) por una SPA React
> dentro de Lovable, leyendo de **Supabase**. El scraping/ETL sigue corriendo
> fuera (GitHub Actions + worker), escribiendo a la misma base Supabase.

## 1. Por qué separado

Lovable no ejecuta Playwright, workers persistentes (pg-boss) ni cron de horas.
Entonces:

- **Lovable/Supabase** → UI + datos de lectura + auth/admin + contador de ahorro.
- **GitHub Actions + worker** → ingesta nocturna (`nightly-scrape.yml`) y
  `finalize` (agregados, purga, deals), apuntando `DATABASE_URL` a Supabase.
- Se elimina `npx vercel --prod` del workflow.

```
[Playwright/adapters] --write--> Supabase Postgres <--read-- [Lovable SPA]
        (GitHub Actions)                     ^
                                             | write (anon RPC)
                                      [savings / admin auth]
```

## 2. Setup de Supabase

Aplicar en este orden (SQL Editor o `psql`), ver `db/supabase/`:

1. `schema.sql` — tablas, particiones, trigger append-only, vistas de análisis.
2. `views.sql` — contratos de lectura para la SPA.
3. `supabase_rls.sql` — RLS en tablas base; `anon`/`authenticated` sólo
   `select` sobre las vistas.
4. `rpc.sql` — funciones `security definer` (búsqueda, detalle, historial,
   ahorro) con `grant execute` a `anon`/`authenticated`.

Import de datos desde Neon (elegir modo):

```powershell
# ~250 MB, entra en el free tier (500 MB): sólo lo publicable
.\db\supabase\import.ps1 -SupabaseUrl "postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres"

# 648 MB: requiere plan Pro (8 GB)
.\db\supabase\import.ps1 -SupabaseUrl "..." -Mode full
```

Después del import, refrescar agregados:

```powershell
pnpm --filter @precios/worker finalize   # con DATABASE_URL apuntando a Supabase
```

## 3. Contrato de datos (lo que consume la SPA)

### Vistas (lectura directa con `supabase-js`)

| Vista             | Uso en la UI                                                       |
| ----------------- | ------------------------------------------------------------------ |
| `v_stores`        | lista de tiendas + `last_captured_at` (freshness)                  |
| `v_categories`    | árbol de categorías (`path`, `product_count`)                      |
| `v_productos`     | `slug, name, brand, category, image_url, best_price, stores_count` |
| `v_offers`        | ofertas por producto/tienda (`distinct on store_id`)               |
| `v_price_history` | serie diaria (`day, min_price, avg_price`)                         |
| `v_deals`         | ofertas publicadas (`badge, expires_at, product_slug`)             |

Todas filtran por la regla publicable:
`stores_count >= 2 and best_price >= 500`, `match_link.status in ('auto','confirmed')`,
`price_record.is_suspect = false`.

### RPCs

```ts
// búsqueda full-text (tsquery + trigram), espeja /api/v1/search
supabase.rpc('search_products', {
  p_q: 'leche',
  p_category: null,
  p_stores: ['dia', 'la-anonima'],
  p_limit: 8,
  p_offset: 0,
});
// -> { slug, name, brand, category, image_url, best_price, stores_count, freshest_captured_at }[]

// detalle de producto + ofertas + agregados + badge de oferta
supabase.rpc('get_product_detail', { p_slug: 'leche-entera-1l' });
// -> { slug,name,brand,ean,unit,{amount,type},category,image_url,
//      offers:[{store,store_name,price,unit_price,promo,source_url,captured_at}],
//      aggregate:{best_price,stores_count,pct_change_7d,pct_change_24h,min_30d,min_90d,avg_30d},
//      deal_badge }  | null

// historial (p_window: '30' | '90' | 'all')
supabase.rpc('product_history', { p_slug: 'leche-entera-1l', p_window: '30' });

// contador de ahorro (única escritura anon)
supabase.rpc('report_savings', { p_device_id, p_savings, p_items });
supabase.rpc('savings_total');
// -> { totalSavings: number, contributors: number }
```

## 4. Rutas / pantallas

| Ruta                      | Contenido                                                                                                                                               | Fuente                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `/`                       | hero + buscador, stats (precios hoy, ahorro total, ofertas, tiendas), supermercado más barato, árbol de categorías, ofertas publicadas, "cómo funciona" | `v_stores`, `savings_total`, `v_categories`, `v_deals`, `v_productos` |
| `/buscar?q=&cat=&tienda=` | resultados + filtros + paginación                                                                                                                       | `search_products`                                                     |
| `/categoria/[slug]`       | grilla de productos de la categoría                                                                                                                     | `v_productos` (por `category`)                                        |
| `/ofertas?cat=&tienda=`   | feed de ofertas publicadas                                                                                                                              | `v_deals`                                                             |
| `/p/[slug]`               | detalle: precio por tienda, chart de historial, badges (–X%)                                                                                            | `get_product_detail` + `product_history`                              |

## 5. Sistema de diseño

Mantener identidad actual (tomar de `apps/web`):

- **Tipografía**: Montserrat.
- **UI**: Tailwind, componentes **shadcn** (`new-york`, base `neutral`).
- **Iconos**: `lucide-react`.
- **Componentes a portar**: `Header`, `Footer`, `ProductCard`, `PriceTable`,
  `HistoryChart` (recharts), `Badge`/`DealBadge`, `SearchBar`, `CategoryNav`,
  `SavingsCounter`, `StorePill`, `FreshnessDot`.
- **Formato local**: `ARS` es-AR, fechas es-AR, links de tienda con `target="_blank" rel="nofollow noopener"`.

## 6. Admin (fase 2)

`/admin` y `/admin/{sigmatecnologias,tandilalerta}` hoy usan `ADMIN_TOKEN_DEV`.
En Lovable: activar **Supabase Auth** (email/OAuth), tabla `admin_user`, y mover
las acciones de escritura (decidir match, publicar deal) a **Edge Functions** con
`service_role`. No exponer escritura admin vía RLS anon.

## 7. Ingesta diaria automática (implementada)

El scraping (Playwright, horas por tienda) y el `finalize` siguen corriendo en
GitHub Actions escribiendo a **Neon**. Lovable no ejecuta Playwright ni cron de
horas, y **no expone credencial de escritura externa** a su Postgres (no hay
password ni `service_role` descargable). Por eso el último paso del workflow
**empuja un snapshot** al sitio, que escribe en Lovable Cloud vía `service_role`.

```
[Playwright/adapters] --write--> Neon
        (GitHub Actions scrape + finalize)
                                    |
              node scripts/lovable-push.mjs  (finalize job)
                                    |  POST /api/ingest  (Bearer INGEST_SECRET)
                                    v
                        [Lovable] src/routes/api.ingest.ts
                                    |  supabaseAdmin (service_role)
                                    v
                        Lovable Cloud (tablas planas) <--read-- SPA
```

- `src/routes/api.ingest.ts` (repo Lovable): `POST /api/ingest` con
  `{ table, mode: "upsert"|"replace", rows[] }`, autenticado con
  `Authorization: Bearer $INGEST_SECRET`. Upsert por PK
  (`offers (product_id,store_id)`, `price_history (product_id,day)`,
  `stores/categories/products/cba_items`), y `replace` (vacía + inserta) para
  `deals`, que no tiene clave natural. `user_savings` no se toca.
- `scripts/lovable-push.mjs` (repo precios-tandil): lee Neon y empuja
  `stores, categories, products, cba_items` completos; `offers` completo
  (último precio por producto/tienda); `price_history` de los últimos
  `HISTORY_DAYS` (default 7; `HISTORY_FULL=1` para todo); y `deals` recalculadas
  contra la serie propia del producto (mismas reglas que
  `drizzle/migrations/0001_deals_fix.sql`, tope 60%).
- `.github/workflows/nightly-scrape.yml`: paso **"Push snapshot a Lovable"** en
  el job `finalize` (después de `finalize`, antes del deploy de Vercel).

### Puesta en marcha (una vez)

1. En Lovable: `More → Cloud → Secrets` → agregar `INGEST_SECRET` (valor
   aleatorio largo).
2. En GitHub → Settings → Secrets → Actions → agregar:
   - `LOVABLE_INGEST_URL` = base pública del sitio, p. ej.
     `https://<proyecto>.lovable.app` (sin `/` final).
   - `LOVABLE_INGEST_SECRET` = el mismo valor que `INGEST_SECRET`.
3. Correr el job manualmente (`workflow_dispatch`) o esperar el cron de las
   03:00 UTC.

### Backfill

El historial ya se cargó completo con `db/seed/real_data.sql`. Para forzar un
envío completo del historial: `HISTORY_FULL=1 node --env-file=.env
scripts/lovable-push.mjs` (con `LOVABLE_INGEST_URL` e `INGEST_SECRET` en el
entorno).

## 8. Variables

| Var                             | Dónde                   | Uso                                 |
| ------------------------------- | ----------------------- | ----------------------------------- |
| `VITE_SUPABASE_URL`             | Lovable (`.env`)        | cliente Supabase (lectura)          |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Lovable (`.env`)        | cliente Supabase (lectura)          |
| `SUPABASE_SERVICE_ROLE_KEY`     | Lovable Cloud (runtime) | escritura del endpoint `api.ingest` |
| `INGEST_SECRET`                 | Lovable Cloud → Secrets | bearer de `POST /api/ingest`        |
| `DATABASE_URL`                  | GitHub Actions (secret) | scraping/finalize → Neon (lectura)  |
| `LOVABLE_INGEST_URL`            | GitHub Actions (secret) | base del sitio de Lovable           |
| `LOVABLE_INGEST_SECRET`         | GitHub Actions (secret) | = `INGEST_SECRET`                   |

## 9. Prompt para Lovable (pegar tal cual)

> Construí una SPA React (Vite + TS + Tailwind + shadcn `new-york`/`neutral`,
> fuente Montserrat, iconos lucide) conectada a mi Supabase.
>
> **Datos**: usá sólo las vistas `v_stores`, `v_categories`, `v_productos`,
> `v_offers`, `v_price_history`, `v_deals`, y las RPCs `search_products`,
> `get_product_detail`, `product_history`, `report_savings`, `savings_total`
> (contratos abajo). No accedas a tablas base.
>
> **Pantallas**: Home, Buscar (`?q`, filtros de categoría/tienda, paginación),
> Categoría, Ofertas, Detalle de producto (precio por tienda + gráfico de
> historial en recharts + badge de descuento). Header/Footer fijos. Responsive,
> mobile-first, precios en es-AR.
>
> **Ahorro**: contador global que llama `savings_total`, y `report_savings`
> con un `device_id` anónimo guardado en localStorage (upsert monótono).
>
> Contratos:
>
> - `search_products(p_q, p_category?, p_stores?, p_limit=8, p_offset=0)` →
>   `{slug,name,brand,category,image_url,best_price,stores_count,freshest_captured_at}[]`
> - `get_product_detail(p_slug)` → `{slug,name,brand,ean,unit,category,image_url,offers[],aggregate{...},deal_badge}`
> - `product_history(p_slug, p_window)` → `{product_slug,window,series[{date,min_price,avg_price}]}`
> - `report_savings(p_device_id,p_savings,p_items)`; `savings_total()` → `{totalSavings,contributors}`

## 10. Checklist

- [x] Datos reales cargados en Lovable Cloud (`db/seed/real_data.sql`).
- [x] `/admin/` eliminado; quedan `/admin/tandilalerta` y `/admin/sigmatecnologias`.
- [x] Endpoint `POST /api/ingest` + paso "Push snapshot a Lovable" en el workflow.
- [ ] `INGEST_SECRET` en Lovable Cloud → Secrets.
- [ ] `LOVABLE_INGEST_URL` y `LOVABLE_INGEST_SECRET` en GitHub → Secrets → Actions.
- [ ] Aplicar `drizzle/migrations/0001_deals_fix.sql` cuando Lovable tenga créditos.
- [ ] Validar la primera corrida (`workflow_dispatch`).
