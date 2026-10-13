# Precios Tandil — Spec de migración a Lovable + Supabase

> **Estado / decisión (actualizado):** se descartó crear un Supabase propio
> (§1–§3 de este doc). La SPA de Lovable ya vive en
> `github.com/arielodasso/perfect-pixel-replica` (TanStack Start + Supabase JS,
> esquema en `drizzle/migrations/`) sobre **Lovable Cloud**, cuyas tablas planas
> (`stores, categories, products, offers, price_history, deals, cba_items,
user_savings`) son un superconjunto 1:1 de las nuestras. Por eso el único
> entregable es **cargar los datos reales** ahí, como migración Drizzle
> `0001_real_data.sql` (generada por `scripts/lovable-export.mjs`). Las secciones
> de schema/views/rpc de abajo quedan como referencia del camino no elegido.

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

## 7. Ingesta (sin cambios de código salvo el destino)

- `nightly-scrape.yml`: matrix por tienda + job `finalize`; cambiar el secret
  `DATABASE_URL` a la cadena de Supabase y borrar el paso `npx vercel --prod`.
- `ecosystem.config.cjs` (local/PM2): `DATABASE_URL` → Supabase.
- Prune/particiones `2026_09`/`2026_10` seguirán funcionando.

## 8. Variables

| Var                         | Dónde                   | Uso                |
| --------------------------- | ----------------------- | ------------------ |
| `VITE_SUPABASE_URL`         | Lovable                 | cliente Supabase   |
| `VITE_SUPABASE_ANON_KEY`    | Lovable                 | cliente Supabase   |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions (server) | admin/escritura    |
| `DATABASE_URL`              | GitHub Actions (secret) | ingesta → Supabase |

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

- [ ] Supabase creado + los 4 SQL aplicados (schema → views → rls → rpc).
- [ ] `import.ps1` corrido (modo `public` o `full`).
- [ ] `worker finalize` contra Supabase.
- [ ] Secret `DATABASE_URL` de GH Actions → Supabase; quitar deploy Vercel.
- [ ] SPA de Lovable desplegada y validada contra las RPCs.
- [ ] (fase 2) Auth + Edge Functions para admin.
