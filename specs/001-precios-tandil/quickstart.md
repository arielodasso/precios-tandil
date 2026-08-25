# Quickstart: Precios Tandil

## Prerrequisitos

- Node.js 22 LTS + pnpm 9+
- Docker Desktop (PostgreSQL 16, Redis)
- Playwright browsers: `pnpm exec playwright install chromium`

## Levantar entorno

```powershell
# 1. Infraestructura
docker compose -f infra/docker-compose.yml up -d postgres redis

# 2. Dependencias
pnpm install

# 3. Migraciones + seeds
pnpm --filter @precios/db migrate
pnpm --filter @precios/db seed

# 4. Worker (una corrida manual de ingesta)
pnpm --filter @precios/worker ingest --store dia

# 5. API
pnpm dev:api                         # http://localhost:3001

# 6. Web
pnpm dev:web                         # http://localhost:3000
```

## Variables de entorno mínimas

```env
DATABASE_URL=postgres://precios:precios@localhost:5432/precios
REDIS_URL=redis://localhost:6379
ADMIN_TOKEN_DEV=dev-token            # solo desarrollo
PROXY_POOL_URL=                      # opcional en dev
SCRAPER_WINDOW_ART=00:00-06:00       # ventana de ingesta masiva
```

## Validación de flujos críticos

1. **US1**: buscar "arroz" en la web → tarjeta con ≥ 2 ofertas ordenadas,
   menor precio en verde con texto "Mejor precio".
2. **US2**: abrir `/p/<slug>` → mínimo 30d y variación semanal en HistoryStrip.
3. **US3**: `POST /api/v1/admin/deals/candidates/:id/publish` con Bearer →
   deal visible en `/ofertas` con badge.
4. **US4**: `GET /api/v1/admin/ingest/runs` con Bearer → reporte de corrida.
5. **Regresión scrapers**: `pnpm test` (fixtures HTML congeladas).

## Comandos útiles

```powershell
pnpm test                 # unit + contract + a11y (136+ tests)
pnpm test:integration     # integración con Testcontainers PG
pnpm test:e2e             # Playwright E2E (requiere stack completo corriendo)
pnpm lint && pnpm typecheck
```
