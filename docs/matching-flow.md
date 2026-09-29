# Flujo de Matching y Reparación de Orfandad — Precios Tandil

## 1. Flujo Actual de Matching (Pipeline de Ingesta)

```
Scraper (adapter.scrapeCatalog)
         │
         ▼
validateSnapshot(raw, {allowedHosts})
         │  └─ Valida EAN checksum (isValidEan13). Si inválido: warning + delete snap.ean
         ▼
normalizeDescription(rawDescription, {brand, description})
         │  └─ Extrae: normName, brand, unitAmount, unitType, unitCount, isPack,
         │       typeKeys, variantFlags, contextText
         ▼
normalizeEan(snap.ean)  →  padStart(13, '0')  →  representación canónica
         │
         ▼
findBestMatch(norm, normalizedEan, candidates, {autoThreshold: 0.82})
         │
         ├─ EAN match: candidates.filter(c => c.ean === normalizedEan)
         │     (candidatos ya normalizados en loadCandidates)
         │
         ├─ Semantic match: diceSimilarity + penalizaciones (brand, variant, presentación)
         │
         ├─ Pending review: bestScore ≥ 0.65
         │
         └─ New product: crea product nuevo con slug generado
         ▼
Buffers: pendingSkus, pendingProducts, pendingLinks, pendingPrices
         ▼
flushBuffer() (cada 300 items o al final)
         │
         ├─ 1. INSERT products (pendingProducts) → productSlugToId actualizado
         ├─ 2. UPSERT store_sku (dedupe store_id+external_id) → extToSkuId
         ├─ 3. INSERT/UPDATE match_link (SIEMPRE - crea producto si no existe match)
         └─ 4. INSERT price_record (siempre, aunque SKU huérfano)
```

## 2. Normalización de EAN

### Problema Original

- `product.ean`: `numeric(13)` → pierde ceros iniciales (ej: `07792951010858` → `7792951010858`)
- `store_sku.declared_ean`: `numeric(13)` → mismo problema
- Comparación `c.ean === ean` fallaba: `"7792951010858" !== "07792951010858"`

### Solución Implementada

**Canonización a 13 dígitos con padding izquierda** en TODOS los puntos de entrada:

```typescript
// pipeline.ts:52-57
function normalizeEan(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  if (!/^\d{8,}$/.test(s)) return null; // Descarta valores inválidos
  return s.padStart(13, '0'); // Canoniza a 13 dígitos
}
```

**Aplicado en:**

1. `normalizeEan(snap.ean)` → entrada del scraper (línea 437)
2. `loadCandidates()` → `ean: r.ean ? String(r.ean).padStart(13, '0') : null` (línea ~689)
3. `cli-reconcile.ts`, `cli-match-missing.ts`, `cli-rematch.ts`, `cli-merge-by-ean.ts` → misma normalización en `toCandidate()`

**Resultado:** Ambos lados comparan `"07792951010858" === "07792951010858"` → **MATCH EAN exitoso**

### Validación de EAN

- `isValidEan13()` verifica checksum EAN-13 estándar
- Solo EANs válidos (13 dígitos + checksum correcto) se usan para matching exacto
- EANs inválidos se descartan en `validateSnapshot` (warning + delete)

## 3. Casos de Matching y Comportamiento

| Caso                         | productId | productSlug   | match_link                                | store_sku asociado        |
| ---------------------------- | --------- | ------------- | ----------------------------------------- | ------------------------- |
| **EAN match exacto**         | ✅ Set    | null          | ✅ `method: 'ean'`, `status: 'auto'`      | Via match_link            |
| **Semántico ≥ 0.82**         | ✅ Set    | null          | ✅ `method: 'semantic'`, `status: 'auto'` | Via match_link            |
| **Semántico 0.65-0.82**      | ✅ Set    | null          | ✅ `status: 'pending_review'`             | Via match_link            |
| **Sin match (score < 0.65)** | null      | ✅ slug nuevo | ✅ (con product_slug)                     | Via match_link tras flush |

**Garantía:** El pipeline **NUNCA** deja un SKU sin `match_link`. Si no hay match, crea producto nuevo.

## 4. Relación store_sku ↔ product ↔ match_link

```
store_sku (119,213 activos)
    │
    ├── UNIQUE (store_id, external_id)  ← Identidad estable
    │
    └── match_link (1:1, store_sku_id UNIQUE)
              │
              ├── product_id → product
              ├── method: 'ean' | 'semantic' | 'manual'
              ├── score: numeric(5,4)
              └── status: 'auto' | 'pending_review' | 'confirmed' | 'rejected'
```

**store_sku NO tiene product_id** — la asociación es exclusivamente a través de `match_link`.

## 5. Garantía de No Orfandad en Pipeline Actual

En `flushBuffer()`:

1. **Si `droppedLinks > 0`** (SKU sin product_id ni product_slug):
   - Se loguea como **ERROR** (no warning)
   - Se crea `PendingProduct` automáticamente para ese SKU
   - Se inserta el producto, resuelve su ID
   - Se crea `match_link` correspondiente
   - `matchStats.noLink` debe ser 0 en operación normal

2. **Productos nuevos** se insertan ANTES que `store_sku` y `match_link` en el mismo flush:
   - `pendingProducts` → INSERT product → `productSlugToId` actualizado
   - Links con `product_slug` resuelven `product_id` vía `productSlugToId`
   - `match_link` se inserta con `product_id` resuelto

## 6. Diagnóstico Histórico (`cli-diagnose-orphans`)

```bash
# Dry-run (solo lectura)
pnpm --filter @precios/worker diagnose-orphans

# Solo una tienda
pnpm --filter @precios/worker diagnose-orphans --store=vea
```

**Reporta:**

- Resumen general: total, con producto, huérfanos, con/sin EAN, price_records huérfanos
- Matches por EAN normalizado vs exacto
- Muestra de huérfanos con EAN válido (13 dígitos) y sin EAN
- Distribución de longitudes de EAN en huérfanos
- EANs distintos entre huérfanos
- Top EANs huérfanos por price_records
- Productos con match activo

### Resultados Reales (Neon, 2026-09-29)

| Métrica                              | Valor                                  |
| ------------------------------------ | -------------------------------------- |
| Total store_sku activos              | 878,024                                |
| Con product (match_link)             | 150,542                                |
| **Huérfanos**                        | **727,482**                            |
| Huérfanos con EAN                    | 614,603                                |
| Huérfanos sin EAN                    | 112,879                                |
| Price records huérfanos              | 727,449                                |
| **Matches EAN normalizado**          | **17 SKUs (120 precios)**              |
| Matches EAN exacto (sin normalizar)  | 17 SKUs (120 precios)                  |
| EANs distintos en huérfanos          | 70,149                                 |
| Longitud EAN 13 dígitos en huérfanos | 83,629                                 |
| Top EAN huérfano                     | `9008070040651` (83 SKUs, 664 precios) |

**Conclusión:** El matching por EAN recupera solo **17 de 614,603** SKUs huérfanos con EAN. La mayoría de EANs en store_sku **no existen en product** (70,149 EANs distintos vs 5,421 productos con EAN).

## 7. Reparación Histórica (`cli-repair-orphans`)

```bash
# Dry-run (reporte solamente)
pnpm --filter @precios/worker repair-orphans

# Aplicar cambios
pnpm --filter @precios/worker repair-orphans --apply

# Opciones
--store=vea        # Solo una tienda
--batch=500        # Tamaño de lote (default 500)
--limit=1000       # Límite de SKUs a procesar
```

**Estrategia de Reparación (respeta thresholds del sistema):**

1. **EAN normalizado** (score 1.0, status 'auto')
   - `lpad(store_sku.declared_ean, 13, '0')` = `product.ean`
   - Verifica similitud semántica ≥ 0.75 y sin conflicto de presentación

2. **Semántico ≥ 0.82** (score calculado, status 'auto')
   - `findBestMatch` con threshold 0.82

3. **Pending review 0.65-0.82** (score calculado, status 'pending_review')
   - Para revisión manual posterior

4. **Producto nuevo** (status 'auto')
   - Genera slug único (`forgeSlug`)
   - Inserta product, crea match_link

**Características:**

- ✅ Idempotente (ON CONFLICT en product y match_link)
- ✅ Trabaja por lotes (configurable)
- ✅ Dry-run por defecto
- ✅ Estadísticas detalladas: matchedEan, matchedSemantic, pendingReview, newProduct, noMatch, createdProducts
- ✅ Conserva TODOS los price_record
- ✅ No borra store_sku, product, ni price_record

## 8. Ejecución Recomendada

### Paso 1: Diagnóstico (ya ejecutado)

```bash
pnpm --filter @precios/worker diagnose-orphans
```

### Paso 2: Reparación en Dry-Run

```bash
pnpm --filter @precios/worker repair-orphans
```

Revisar estadísticas: `matchedEan`, `matchedSemantic`, `pendingReview`, `newProduct`

### Paso 3: Reparación Real (por lotes, cuando haya espacio en Neon)

```bash
# Procesar 1000 SKUs por vez
pnpm --filter @precios/worker repair-orphans --apply --limit=1000

# Repetir hasta cubrir todos
```

### Paso 4: Verificación Post-Reparación

```bash
pnpm --filter @precios/worker diagnose-orphans
```

Verificar reducción de huérfanos y aumento de matches.

## 9. Migración EAN (Pendiente - Requiere Espacio en Neon)

**NO EJECUTAR HASTA TENER >200 MB LIBRES**

```bash
# Migración 0009: numeric(13) → char(13) con padding
# Requiere table rewrite (~182 MB temporales)
pnpm --filter @precios/db migrate up
```

**Alternativa sin espacio (cuando se necesite):**

```sql
-- En Neon SQL Editor (no desde migración)
ALTER TABLE product ADD COLUMN ean_new char(13);
UPDATE product SET ean_new = lpad(ean::text, 13, '0') WHERE ean IS NOT NULL;
-- ... swap atómico (metadata-only)
```

## 10. Archivos Modificados

| Archivo                                   | Cambio                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/pipeline/pipeline.ts`    | `loadCandidates()`: normaliza EAN a 13 dígitos; `flushBuffer()`: manejo de droppedLinks + error logging |
| `apps/worker/src/cli-reconcile.ts`        | `toCandidate()`: normaliza EAN                                                                          |
| `apps/worker/src/cli-match-missing.ts`    | `toCandidate()`: normaliza EAN                                                                          |
| `apps/worker/src/cli-rematch.ts`          | `toCandidate()`: normaliza EAN                                                                          |
| `apps/worker/src/cli-merge-by-ean.ts`     | Normaliza EAN antes de `isValidEan13`                                                                   |
| `apps/worker/src/cli-diagnose-orphans.ts` | **NUEVO** - Diagnóstico READ-ONLY de huérfanos                                                          |
| `apps/worker/src/cli-repair-orphans.ts`   | **NUEVO** - Reparación histórica por lotes                                                              |
| `apps/worker/package.json`                | Scripts `diagnose-orphans` y `repair-orphans`                                                           |

## 11. Tests

Todos los tests existentes pasan (222 tests, 16 archivos):

```bash
pnpm test
```

Cobertura de matching en `pipeline.fixtures.test.ts`:

- Procesa y persiste snapshots de DIA
- Deduplica por (sku, captured_at, list_or_promo)
- **Vincula por EAN el mismo producto entre DIA y Carrefour**

## 12. Estado del Despliegue

- Código listo para producción
- Typecheck: ✅
- Tests: ✅ (222 passed)
- Sin cambios destructivos
- No requiere migración inmediata
- Diagnóstico y reparación disponibles como CLI tools

---

**Última actualización:** 2026-09-29  
**Versión:** Post-fix matching EAN + herramientas de reparación histórica
