---
description: 'Task list for Precios Tandil feature implementation'
---

# Tasks: Precios Tandil — Motor de Análisis y Plataforma Web de Precios

**Input**: Design documents from `/specs/001-precios-tandil/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, design/site-design.contract.yaml ✅

**Tests**: Incluidos según Constitution (Quality Gates): contract tests de adaptadores obligatorios; unit en normalizer/price-math con cobertura ≥ 90 %.

**Organization**: Tareas agrupadas por user story para entrega incremental e independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivos distintos, sin dependencias)
- **[Story]**: user story propietaria (US1–US4)
- Rutas exactas incluidas en cada descripción

## Path Conventions

- Monorepo pnpm: `apps/{api,web,worker}`, `packages/*`, `db/`, `infra/`, `tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Estructura del monorepo y tooling base

- [x] T001 Inicializar monorepo pnpm con workspaces `apps/*`, `packages/*` y TypeScript 5.x strict + paths compartidos (`pnpm-workspace.yaml`, `tsconfig.base.json`)
- [x] T002 Configurar tooling común: ESLint flat config, Prettier, husky+lint-staged, scripts raíz `lint/typecheck/test` en `package.json`
- [x] T003 [P] Crear `infra/docker-compose.yml` (postgres:16, redis:7) y `.env.example` con variables del quickstart
- [x] T004 [P] Crear `packages/shared` con tipos base (`StoreSlug`, `ProductSnapshot`, errores canónicos) y utilidades ARS/fechas ART-UTC en `packages/shared/src/`
- [x] T005 Configurar CI (GitHub Actions): lint → typecheck → test → build en `.github/workflows/ci.yml`, con jobs de presupuesto de rendimiento placeholder

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DB, contratos y pipeline mínimo que TODA story necesita

**⚠️ CRITICAL**: Ninguna user story comienza antes de completar esta fase

- [x] T010 Setup proyecto `db/` con node-pg-migrate, conexión vía `DATABASE_URL` y script `migrate` en `db/package.json`
- [x] T011 Escribir migración inicial completa según data-model.md: tablas `store`, `category`, `product`, `store_sku`, `match_link`, `price_record` (particionada + rules append-only), `price_aggregate`, `run_report`, `deal_candidate`, `deal_publication`, `admin_token` en `db/migrations/0001_init.sql`
- [x] T012 [P] Seeds: 6 tiendas objetivo (slugs carrefour/monarca/comerciante-maxi/dia/cooperativa-obrera/vea con URLs de spec) + árbol de categorías básico en `db/seeds/`
- [x] T013 Implementar cliente DB tipado con Kysely en `apps/api/src/lib/db.ts` + `apps/worker/src/lib/db.ts` (schema types generados)
- [x] T014 Implementar contrato `ScraperAdapter` + tipos (`ProductSnapshot`, `AdapterContext`) en `packages/scraper-core/src/contract.ts` según contracts/adapter-contract.md
- [x] T015 Implementar `ResilientHttpClient`: rotación User-Agents, pool de proxies configurable, reintentos backoff exponencial+jitter (3 intentos), circuit breaker (3 fallos→cuarentena) en `packages/scraper-core/src/http/resilient-http-client.ts`
- [x] T016 [P] Implementar validadores pre-persistencia de snapshots (precio>0, ARS, URL dominio tienda, checksum EAN, flag suspect >80%) en `packages/scraper-core/src/validation/snapshot-validator.ts` con tests unitarios
- [x] T017 Implementar normalizador léxico v1: unaccent, lowercase, stopwords ES-AR, extracción marca/unidad/cantidad en `packages/normalizer/src/clean/normalize.ts` (cobertura ≥90%)
- [x] T018 Implementar matching EAN-13 primario + scoring trigram/fuzzy fallback con umbral config y marcado `match_method` en `packages/normalizer/src/match/matcher.ts`
- [x] T019 Implementar pipeline worker core: scrape→validate→normalize→match→persist (append-only, dedupe intra-corrida) en `apps/worker/src/pipeline/pipeline.ts` con logs pino correlation-id
- [x] T020 Setup pg-boss en worker: colas ingest/deals/aggregates, scheduler cron ventana 00:00–06:00 ART por tienda en `apps/worker/src/scheduler/scheduler.ts`
- [x] T021 Implementar escritura de `run_report` + eventos de cuarentena en `apps/worker/src/pipeline/run-reporter.ts`
- [x] T022 Setup API Fastify base: plugins cors/rate-limit/helmet, logging pino, error handler canónico, healthcheck `/healthz` en `apps/api/src/app.ts`
- [x] T023 Implementar auth Bearer admin (hash sha256 contra `admin_token`) como plugin en `apps/api/src/plugins/auth.ts`
- [x] T024 [P] Testcontainers PG: fixture de integración que corre migraciones+seeds para tests en `tests/integration/helpers/db.ts`

**Checkpoint**: Foundation lista — pipeline puede capturar de 1 tienda real y persistir; API responde healthcheck. Las stories pueden ejecutarse en paralelo.

---

## Phase 3: User Story 1 — Comparar precios en góndola (Priority: P1) 🎯 MVP

**Goal**: Un vecino busca un producto y ve la comparación multi-tienda en ≤ 3 s en móvil.

**Independent Test**: Con precios de ≥ 2 tiendas en DB, flujo búsqueda→tarjeta funciona en dispositivo móvil real; Lighthouse móvil LCP < 2.5 s.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T025 [P] [US1] Contract test adaptador DIA contra fixture HTML congelada: extrae snapshot válido (precio, EAN, descripción) en `packages/adapters/dia/tests/fixture.test.ts`
- [x] T026 [P] [US1] Contract test adaptador Carrefour contra fixture HTML en `packages/adapters/carrefour/tests/fixture.test.ts`
- [x] T027 [P] [US1] Integration test search+product endpoints contra PG real (datos seed) en `tests/integration/api/search.test.ts` + `products.test.ts`
- [x] T028 [P] [US1] E2E Playwright: buscar "arroz" → tarjeta con ≥2 ofertas ordenadas, menor en verde con texto "Mejor precio" en `apps/web/e2e/us1-compare.spec.ts`

### Implementation for User Story 1

- [x] T029 [P] [US1] Implementar adaptador DIA (Playwright, listing+producto, selectores aislados) en `packages/adapters/dia/src/index.ts`
- [x] T030 [P] [US1] Implementar adaptador Carrefour en `packages/adapters/carrefour/src/index.ts`
- [x] T031 [P] [US1] Implementar adaptador Vea en `packages/adapters/vea/src/index.ts`
- [x] T032 [P] [US1] Implementar adaptador Monarca en `packages/adapters/monarca/src/index.ts`
- [ ] T033 [P] [US1] Implementar adaptador Comerciante/Carrefour Maxi en `packages/adapters/comerciante-maxi/src/index.ts` ⚠️ POSTERGADA: la tienda es wholesale y oculta precios a usuarios anónimos (`data-price="private"`, botón "VER PRECIO" → login). El endpoint AJAX público `products?method=productsList` solo expone EAN/descripción/categorías. Requiere sesión autenticada (credenciales) o acuerdo de datos; se retoma cuando exista acceso.
- [ ] T034 [P] [US1] Implementar adaptador Cooperativa Obrera en `packages/adapters/cooperativa-obrera/src/index.ts` ⚠️ POSTERGADA: el e-commerce (lacoopeencasa.coop, Angular SPA + `api.lacoopeencasa.coop`) solo expone públicamente `GET /api/articulos/destacados`, `GET /api/articulos/relacionados?cod_interno=` y `GET /api/categorias/arbol` (con precios reales). El listado paginado por categoría (`POST /api/articulos/pagina`) exige un contexto de sesión/localidad no reconstruible de forma anónima. Requiere cuenta o acuerdo de datos para cobertura completa del catálogo.
- [x] T035 [US1] Implementar job de agregados base (best price por producto, stores_count, frescura) escribiendo `price_aggregate` en `apps/worker/src/jobs/refresh-aggregates.ts` (depends T011,T019) — SQL validado contra Postgres real vía PGlite (exclusión suspect/rejected, tiebreak promo, eliminación de rancios, idempotencia)
- [x] T036 [US1] Implementar endpoint GET /api/v1/search con autocompletado (tsvector+trgm, ≤300ms) y filtros categoría/tienda en `apps/api/src/routes/v1/search.ts` (depends T035) — SQL validado contra Postgres real vía PGlite+pg_trgm (relevancia, typos, filtros subtree/tienda, cursor); 9 tests unit + 4 integración
- [x] T037 [US1] Implementar endpoint GET /api/v1/products/:slug (tarjeta comparación, ofertas asc, is_stale, summary) en `apps/api/src/routes/v1/products.ts` — SQL validado contra Postgres real vía PGlite (distinct-on por tienda con tiebreak promo, exclusión rechazados, stale >7d fuera del summary, spread sobre frescos, deal_badge); 3 tests integración
- [x] T038 [US1] Implementar GET /api/v1/categories y GET /api/v1/stores en `apps/api/src/routes/v1/taxonomy.ts`
- [x] T039 [US1] Caché Redis (search 5min, product 5min) + invalidación por aggregates.refreshed en `apps/api/src/plugins/cache.ts`
- [x] T040 [US1] Scaffold Next.js App Router mobile-first con Tailwind, tokens del design contract (paleta light/dark, Inter subset) en `apps/web/src/app/layout.tsx` + `apps/web/tailwind.config.ts`
- [x] T041 [US1] Implementar SearchBar predictivo sticky (combobox a11y, debounce 150ms, skeletons) en `apps/web/src/components/SearchBar.tsx`
- [x] T042 [US1] Implementar ProductComparisonCard según anatomía del design contract (hero verde+chip "Mejor precio", breakdown por tienda, frescura) en `apps/web/src/components/ProductComparisonCard.tsx`
- [x] T043 [US1] Implementar home (/) con category chips scroll-snap y estados empty/loading en `apps/web/src/app/page.tsx`
- [x] T044 [US1] Implementar página producto SSR/ISR `/p/[slug]` con JSON-LD Product+Offer, OG tags y canonical en `apps/web/src/app/p/[slug]/page.tsx`
- [x] T045 [US1] Footer co-branding "Tecnología de análisis impulsada por Sigma | Difundido por Tandil Alerta" global en `apps/web/src/components/Footer.tsx`
- [x] T046 [US1] Toggle dark/light (prefers-color-scheme + persistencia) en `apps/web/src/components/ThemeToggle.tsx`

**Checkpoint**: US1 completa — MVP demostrable end-to-end con ≥2 tiendas reales.

---

## Phase 4: User Story 2 — Historial y mejor precio histórico (Priority: P2)

**Goal**: El vecino decide si conviene comprar viendo mínimos y variaciones.

**Independent Test**: Con histórico sintético cargado, métricas correctas visibles en tarjeta; datos <7 días muestran "Datos insuficientes".

### Tests for User Story 2 ⚠️

- [x] T047 [P] [US2] Unit tests cálculo variaciones % diaria/semanal y mínimos por ventana (casos borde: sin previo, suspect excluido) en `packages/shared/src/price-math/price-math.test.ts` (≥90% cobertura)
- [x] T048 [P] [US2] Integration test history endpoint con serie sintética 90 días en `tests/integration/api/history.test.ts`
- [x] T049 [P] [US2] E2E: abrir historial muestra min_30d, badge "Cerca del mínimo histórico" y "+X% esta semana" en rojo con texto en `apps/web/e2e/us2-history.spec.ts`

### Implementation for User Story 2

- [x] T050 [US2] Implementar módulo price-math puro (variaciones, mínimos 30/90/all, avg30d, near_min_90d) en `packages/shared/src/price-math/price-math.ts` (depends T047)
- [x] T051 [US2] Extender refresh-aggregates para calcular pct_change_24h/7d, min_30d/90d/all, avg_30d excluyendo suspects en `apps/worker/src/jobs/refresh-aggregates.ts`
- [x] T052 [US2] Materializar serie diaria (último precio válido por día por producto) via vista materializada + refresh job en `db/migrations/0002_daily_series.sql` y `apps/worker/src/jobs/refresh-daily-series.ts`
- [x] T053 [US2] Endpoint GET /products/:slug/history?window= servido desde aggregate+serie (p95<200ms, cache 1h) en `apps/api/src/routes/v1/history.ts`
- [x] T054 [US2] HistoryStrip en ProductComparisonCard: sparkline SVG ligero, stats y badges "Cerca del mínimo histórico"/"+X% esta semana" con texto en `apps/web/src/components/HistoryStrip.tsx`
- [x] T055 [US2] Regla "Datos insuficientes" (<7 días) en UI y API en `apps/web/src/components/HistoryStrip.tsx` + `apps/api/src/routes/v1/history.ts`

**Checkpoint**: US1+US2 operativas independientemente.

---

## Phase 5: User Story 3 — Oportunidades difundidas por Tandil Alerta (Priority: P3)

**Goal**: Candidatas automáticas validadas editorialmente y difundidas con badge visible.

**Independent Test**: Detectar candidata desde datos de prueba, aprobarla en admin, ver badge en home y URL compartible con OG.

### Tests for User Story 3 ⚠️

- [x] T056 [P] [US3] Unit test detector oportunidades (umbral 15% vs avg30d, ≥2 tiendas frescas, no reproponer rechazadas 14 días) en `apps/worker/src/jobs/detect-deals.test.ts`
- [x] T057 [P] [US3] Integration test flujo candidate→publish→visible en /deals y home en `tests/integration/api/deals.test.ts`

### Implementation for User Story 3

- [x] T058 [US3] Job diario detect-deals generando deal_candidate con evidencia JSON en `apps/worker/src/jobs/detect-deals.ts` (depends T051)
- [x] T059 [US3] Endpoints admin deals: GET candidates, POST publish/reject (rejected_until=+14d) auditados en `apps/api/src/routes/admin/deals.ts`
- [x] T060 [US3] Endpoint público GET /api/v1/deals?status=published en `apps/api/src/routes/v1/deals.ts`
- [x] T061 [US3] DealBadge component (variants gold/green del design contract) en `apps/web/src/components/DealBadge.tsx`
- [x] T062 [US3] Sección top_deals en home + página /ofertas en `apps/web/src/app/page.tsx` y `apps/web/src/app/ofertas/page.tsx`
- [x] T063 [US3] OG image dinámica por producto (mejor precio sobre imagen) en `apps/web/src/app/p/[slug]/opengraph-image.tsx`

**Checkpoint**: Flujo completo de oportunidad operativo sin intervención técnica.

---

## Phase 6: User Story 4 — Operación y monitoreo de ingesta (Priority: P4)

**Goal**: Operadores ven estado de ingesta, cuarentenas y cola de matches; relanzan scrapers.

**Independent Test**: Corrida con adaptador forzado a fallar genera reporte, cuarentena y retry manual exitoso.

### Tests for User Story 4 ⚠️

- [x] T064 [P] [US4] Integration test runs/retry endpoints (incluye 409 run_in_progress) en `tests/integration/api/admin-ingest.test.ts`
- [x] T065 [P] [US4] Integration test decisiones de match auditadas (confirm/reject) en `tests/integration/api/admin-matches.test.ts`

### Implementation for User Story 4

- [x] T066 [US4] Endpoints admin ingest: GET runs, POST stores/:slug/retry (202/409) en `apps/api/src/routes/admin/ingest.ts`
- [x] T067 [US4] Endpoints admin matches: GET pending, POST decision en `apps/api/src/routes/admin/matches.ts`
- [x] T068 [US4] Vista admin protegida /admin: tabla runs por tienda, botón retry, cola de revisión de matches (confirmar/rechazar) en `apps/web/src/app/admin/page.tsx`
- [x] T069 [US4] Panel de alertas ops: cuarentena>24h, rechazo>20%, frescura>72h → webhook canal Tandil Alerta/Sigma en `apps/worker/src/jobs/ops-alerts.ts`
- [x] T070 [US4] Dashboard métricas Prometheus (duración corridas, SKUs capturados/rechazados, tasa EAN, latencia p95 API) en `apps/api/src/plugins/metrics.ts` + `infra/grafana/dashboard.json`

**Checkpoint**: Las 4 stories operan independientemente.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Robustez, rendimiento y cierre constitucional

- [x] T071 [P] Sitemap dinámico + robots.txt + metadatos locales SEO en `apps/web/src/app/sitemap.ts`
- [x] T072 Presupuestos rendimiento en CI: k6 smoke API p95<200ms + Lighthouse CI móvil (LCP<2.5s, INP<200ms, CLS<0.1, JS<150KB) bloqueando merge en `.github/workflows/perf.yml`
- [x] T073 Auditoría accesibilidad AA (axe-core en E2E + revisión manual flujos críticos) en `tests/e2e/a11y.test.ts`
- [x] T074 [P] Manejo edge cases UI: stale_notice, "Solo disponible en X", búsquedas sin resultados con sugerencias en `apps/web/src/components/*`
- [x] T075 [P] Rate limiting público (60 req/min/IP) + hardening headers en `apps/api/src/plugins/security.ts`
- [x] T076 Particionado automático mensual de price_record (job crea partición siguiente + retención policy) en `apps/worker/src/jobs/partition-maintenance.ts`
- [x] T077 Runbook operativo: cómo diagnosticar adaptador en cuarentena, regenerar fixtures tras cambio de DOM, relanzar corridas en `docs/runbook.md`
- [x] T078 Validar quickstart.md completo en entorno limpio y cerrar checklist de Constitution compliance

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: sin dependencias → inmediato
- **Foundational (2)**: depende de Setup — BLOQUEA todas las stories
- **US1 (3)**: MVP — primera story tras Foundation
- **US2 (4)**: requiere T051 (agregados de US1); resto independiente
- **US3 (5)**: requiere agregados (T051); independiente de US2
- **US4 (6)**: requiere pipeline+auth foundation; puede paralelizarse con US2/US3
- **Polish (7)**: tras stories deseadas

### Adaptadores (T029–T034)

Los 6 adaptadores son [P]: se desarrollan en paralelo una vez T014–T016 listos.
Orden sugerido de activación: DIA → Carrefour → Vea (mayor catálogo local),
luego Monarca, Comerciante, Cooperativa Obrera.

### Parallel Opportunities

- T003/T004 con T002; todos los contract tests [P]; los 6 adaptadores [P];
  tests de cada story [P] antes de su implementación; US2/US3/US4 en paralelo
  tras US1 checkpoint si hay capacidad.

---

## Implementation Strategy

### MVP First (solo US1)

1. Fases 1–2 completas → 2. Fase 3 con ≥2 adaptadores → 3. STOP: validar
   regla de 3 segundos en móvil real → 4. Publicar beta a Tandil Alerta.

### Incremental Delivery

Cada story agrega valor sin romper anteriores: +historial (confianza),
+oportunidades (crecimiento vía Tandil Alerta), +operación (fiabilidad).

---

## Notes

- Fixtures HTML: capturar páginas reales al implementar cada adaptador y
  congelarlas en `packages/adapters/<tienda>/tests/fixtures/`.
- Ninguna tarea escribe UPDATE/DELETE sobre price_record (Constitution V).
- Commit después de cada tarea o grupo lógico; validar checkpoint de story
  antes de avanzar prioridad.
