# Contrato REST API v1 — Precios Tandil

Base URL pública: `https://api.preciostandil.ar/api/v1`
Admin: mismo host bajo `/api/admin/*` con `Authorization: Bearer <token>`.

Convenciones: JSON UTF-8; fechas ISO-8601 UTC; precios en ARS con 2 decimales;
errores `{ "error": { "code", "message" } }`; paginación cursor-based
(`?cursor=&limit=`, default limit 20, máx 50). Rate-limit público: 60 req/min/IP.

## Público

### GET /search

Búsqueda predictiva con autocompletado.

| Query | Tipo | Req | Notas |
|---|---|---|---|
| q | string | sí | 2–64 chars |
| category | string | no | slug de categoría |
| store | string[] | no | slugs de tienda |
| limit | int | no | default 8, máx 20 |

Respuesta 200:

```json
{
  "results": [
    {
      "slug": "arroz-gallo-oro-1kg",
      "name": "Arroz Gallo Oro 1kg",
      "brand": "Gallo",
      "category": "almacen/arroz",
      "image_url": "https://…/img.webp",
      "best_price": 1590.00,
      "stores_count": 3,
      "freshest_captured_at": "2026-08-20T03:12:00Z"
    }
  ],
  "next_cursor": null
}
```

SLO server-side p95 ≤ 300 ms. Cache: Redis 5 min.

### GET /products/{slug}

Tarjeta de comparación completa del producto unificado.

Respuesta 200:

```json
{
  "slug": "arroz-gallo-oro-1kg",
  "name": "Arroz Gallo Oro 1kg",
  "brand": "Gallo",
  "ean": 7791234567890,
  "unit": { "amount": 1.0, "type": "kg" },
  "category": "almacen/arroz",
  "offers": [
    {
      "store": "dia",
      "store_name": "DIA",
      "price": 1590.00,
      "unit_price": 1590.000,
      "promo": false,
      "source_url": "https://…",
      "captured_at": "2026-08-20T03:12:00Z",
      "freshness_hours": 14,
      "is_stale": false
    }
  ],
  "summary": {
    "best_store": "dia",
    "best_price": 1590.00,
    "worst_price": 1899.00,
    "spread_pct": 19.4,
    "pct_change_7d": -4.8,
    "min_30d": 1550.00,
    "near_min_90d": true
  },
  "deal_badge": null
}
```

Reglas: ofertas ordenadas por precio asc; tiendas con frescura > 7 días quedan
con `is_stale=true` y excluidas de `summary.best_*`; producto sin datos frescos
→ 200 con `offers: []` y campo `stale_notice`.

### GET /products/{slug}/history?window=30|90|all

Serie histórica diaria (último precio válido por día) + agregados.

```json
{
  "window_days": 30,
  "series": [
    { "date": "2026-07-22", "min_price": 1650.00, "avg_price": 1690.00 }
  ],
  "stats": {
    "min_window": 1550.00, "max_window": 1899.00,
    "pct_change_7d": -4.8, "pct_change_24h": 0.0, "avg_30d": 1701.25
  }
}
```

Cache: Redis 1 h. SLO p95 ≤ 200 ms (datos servidos desde price_aggregate +
serie materializada).

### GET /categories — árbol de categorías con conteo de productos.
### GET /stores — tiendas activas, última actualización y estado de frescura.
### GET /deals?status=published — oportunidades vigentes (badge, % descuento, evidencia resumida, enlace `/p/<slug>`).

## Admin (Bearer token)

### GET /admin/ingest/runs?store=&limit=
Reportes de corrida (run_report): estado, contadores, errores sample, cuarentena.

### POST /admin/ingest/stores/{slug}/retry
Encola corrida manual del adaptador. Respuesta 202 `{ "run_id": "…" }`.
Idempotente mientras exista una corrida `running` para la tienda (409).

### GET /admin/matches/pending?cursor=
Matches semánticos pendientes: descripciones comparadas, score, EANs.

### POST /admin/matches/{id}/decision
Body: `{ "decision": "confirm" | "reject" }` → audita `decided_by/at`.

### GET /admin/deals/candidates?status=pending
### POST /admin/deals/{id}/publish → crea deal_publication (badge visible en home).
### POST /admin/deals/{id}/reject → setea rejected_until = now()+14 días.

## Códigos de error

| HTTP | code | Cuándo |
|---|---|---|
| 400 | invalid_query | parámetros inválidos |
| 401 | unauthorized | token admin ausente/inválido |
| 404 | not_found | slug inexistente |
| 409 | run_in_progress | retry con corrida activa |
| 429 | rate_limited | exceso de requests |
| 500 | internal_error | no esperado (log correlation-id) |
