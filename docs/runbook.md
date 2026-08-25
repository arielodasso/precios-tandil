# Runbook Operativo — Precios Tandil

## 1. Adaptador en cuarentena

**Síntoma**: Un store no tiene precios nuevos en >72h. Los `run_report` muestran `quarantined: true`.

**Diagnóstico**:

```sql
SELECT rr.run_id, s.slug, rr.status, rr.quarantined, rr.http_errors,
       rr.started_at, rr.finished_at
FROM run_report rr
JOIN store s ON s.id = rr.store_id
WHERE s.slug = 'SLUG_DEL_STORE'
ORDER BY rr.started_at DESC LIMIT 10;
```

**Causas comunes**:

1. La tienda cambió el DOM → adaptador falla al parsear.
2. La tienda bloqueó IPs (rate limit, CAPTCHA).
3. Proxy caído o IP en lista negra.

**Resolución**:

1. Revisar logs del worker: `pnpm --filter @precios/worker dev` con `LOG_LEVEL=debug`.
2. Ejecutar manual: `pnpm --filter @precios/worker cli-ingest --store SLUG`.
3. Si es cambio de DOM → actualizar selectores en `packages/adapters/<tienda>/src/index.ts`.
4. Crear fixture HTML nuevo → `packages/adapters/<tienda>/tests/fixtures/`.
5. Re-ejecutar contract test: `pnpm test --filter adapter-<tienda>`.
6. Des-habilitar cuarentena:
   ```sql
   UPDATE store SET config = jsonb_set(config, '{quarantine}', 'false') WHERE slug = 'SLUG';
   ```
7. Relanzar corrida desde admin: POST `/api/v1/admin/ingest/stores/SLUG/retry` con Bearer token.

---

## 2. Regenerar fixtures tras cambio de DOM

1. Abrir Playwright con el adaptador:
   ```bash
   cd packages/adapters/<tienda>
   npx playwright open URL_DE_LA_TIENDA
   ```
2. Guardar HTML de la página de categoría en `tests/fixtures/<nombre>.html`.
3. Actualizar el test de fixture para apuntar al nuevo archivo.
4. Verificar que el test pasa: `pnpm test --filter adapter-<tienda>`.

---

## 3. Relanzar una corrida de ingesta

**Via API** (requiere Bearer admin):

```bash
curl -X POST http://localhost:8080/api/v1/admin/ingest/stores/dia/retry \
  -H "Authorization: Bearer TU_TOKEN"
```

- `202 Accepted`: la corrida fue encolada.
- `409 Conflict`: ya hay una corrida en curso para esa tienda (últimas 4 horas).

**Via pg-boss** (si tienes acceso a la DB):

```sql
SELECT * FROM pgboss.job WHERE name = 'ingest' ORDER BY createdon DESC LIMIT 10;
```

---

## 4. Diagnosticar candidatos rechazados

Un candidato de oportunidad puede ser rechazado por el admin. El cooldown es de 14 días.

```sql
SELECT dc.product_id, p.slug, dc.status, dc.rejected_until, dc.discount_pct
FROM deal_candidate dc
JOIN product p ON p.id = dc.product_id
WHERE dc.status = 'rejected'
ORDER BY dc.rejected_until DESC;
```

Para volver a proponer antes del cooldown, eliminar el registro:

```sql
DELETE FROM deal_candidate WHERE id = ID_DEL_CANDIDATO;
```

---

## 5. Mantenimiento de particiones

El job `partition-maintenance` crea particiones mensuales automáticamente (corre el día 25 de cada mes).

Para verificar particiones actuales:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'price_record_%'
ORDER BY tablename;
```

Para forzar limpieza de particiones viejas (>13 meses):

```sql
-- Cuidado: esto elimina datos permanentemente
DROP TABLE IF EXISTS price_record_202501;
```

---

## 6. Métricas y alertas

**Endpoints de monitoreo**:

- `GET /healthz` — health check (pings DB).
- `GET /metrics` — métricas Prometheus.

**Métricas clave**:

- `api_http_request_duration_seconds` — latencia API (p95 < 200ms).
- `run_report.skus_captured` — SKUs exitosos por corrida.
- `run_report.http_errors` — errores HTTP por corrida.
- `run_report.quarantined` — tiendas en cuarentena.

**Alertas del worker** (webhook Tandil Alerta):

- Cuarentena >24h
- Tasa de rechazo >20%
- Frescura >72h sin datos nuevos

---

## 7. Desarrollo local

```bash
# Arrancar infra
docker compose up -d

# Migrar DB
pnpm db:migrate && pnpm db:seed

# Desarrollo
pnpm dev:api      # API en :8080
pnpm dev:worker   # Worker con pg-boss
pnpm dev:web      # Next.js en :3000

# Tests
pnpm lint && pnpm typecheck && pnpm test

# Integración (requiere Docker para Testcontainers)
pnpm test:integration
```

---

## 8. Variables de entorno críticas

| Variable          | Descripción                                | Default     |
| ----------------- | ------------------------------------------ | ----------- |
| `DATABASE_URL`    | URL de conexión PostgreSQL                 | requerida   |
| `REDIS_URL`       | URL de Redis (opcional, usa memoria si no) | —           |
| `ADMIN_TOKEN_DEV` | Token admin para desarrollo                | —           |
| `PORT`            | Puerto de la API                           | 8080        |
| `NODE_ENV`        | Producción o desarrollo                    | development |

Nunca commitear valores reales. Usar `.env.local` (en `.gitignore`).
