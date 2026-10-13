# Precios Tandil — una sola base: Supabase propio (camino directo)

> Reemplaza la arquitectura `Neon -> /api/ingest -> Lovable Cloud` por:
> **un Supabase propio** que es a la vez la base del scraper y la base que
> lee la SPA. El scraper escribe **directo** (sin endpoint, sin Neon).
> La SPA no cambia: sigue leyendo las tablas planas (`stores`, `products`,
> `offers`, `price_history`, `deals`, `cba_items`) y las RPC `report_savings`
> y `savings_total`.

```
[Playwright/adapters] --write--> Supabase (schema normalizado)
   (GitHub Actions)                       |
                        serving-sync.mjs (misma base, directo)
                                          v
                          Supabase (tablas planas) <--read-- SPA (anon)
```

## Qué queda en la misma base

| Modelo                       | Objetos                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Normalizado (scraper)        | `store, category, product, store_sku, match_link, price_record, price_aggregate, deal_candidate, deal_publication, daily_series` |
| Serving (SPA, tablas planas) | `stores, categories, products, offers, price_history, deals, cba_items`                                                          |
| Ahorro (una sola tabla)      | `user_savings` (normalizada) expuesta por las RPC que espera la SPA                                                              |

Sin choques: el modelo normalizado usa nombres singulares y el serving plurales.
El único solape (`user_savings` + `report_savings`/`savings_total`) se resuelve en
`db/supabase/serving.sql` (firma de la SPA sobre la tabla normalizada).

## Piezas del repo

- `db/supabase/schema.sql` — schema normalizado (scraper).
- `db/supabase/views.sql` — vistas `v_*` (no las usa la SPA, pero sirven/asisten).
- `db/supabase/supabase_rls.sql` — RLS + grants de Supabase.
- `db/supabase/serving.sql` — **nuevo**: tablas planas + RPC del contador + baseline $4.314.951.
- `db/supabase/import.ps1` — migra schema + datos de Neon a Supabase (ya aplica `serving.sql`).
- `scripts/serving-sync.mjs` — **nuevo**: sync directo del modelo normalizado a tablas planas.
- `.github/workflows/nightly-scrape.yml` — interruptor `vars.SUPABASE_DIRECT`.

## Puesta en marcha (una vez)

1. Crear el proyecto en [supabase.com](https://supabase.com) y juntar:
   - **Project URL** (p. ej. `https://xxxx.supabase.co`).
   - **anon/publishable key** (`sb_publishable_...` o JWT `anon`).
   - **service_role key** (para el sync; no se usa desde el navegador).
   - **Connection string** (Database → Connection pooling, **puerto 6543**).
2. Aplicar schema + datos:
   ```powershell
   cd "C:\Users\ariel\OneDrive\Escritorio\ARIEL\Sigma\Precios Tandil"
   .\db\supabase\import.ps1 -SupabaseUrl "postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:6543/postgres"
   ```
3. Refrescar agregados contra Supabase:
   ```powershell
   $env:DATABASE_URL = "<connection string>"
   pnpm --filter @precios/worker finalize
   node scripts/serving-sync.mjs        # primer snapshot a tablas planas
   ```
4. En la SPA (`perfect-pixel-replica/.env`): apuntar a tu Supabase
   ```
   VITE_SUPABASE_URL="https://xxxx.supabase.co"
   VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
   SUPABASE_URL="https://xxxx.supabase.co"
   SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
   ```
   (commit + push; Lovable sincroniza)
5. GitHub → Secrets → Actions:
   - `DATABASE_URL` = connection string de Supabase.
     GitHub → Variables → Actions: `SUPABASE_DIRECT = true`.
     Con eso el `finalize` y el sync corren contra Supabase y se ignora el push HTTP.

## Rollback

`SUPABASE_DIRECT = false` (o borrar la variable) vuelve al push HTTP de Lovable
mientras `DATABASE_URL` siga siendo Neon.
