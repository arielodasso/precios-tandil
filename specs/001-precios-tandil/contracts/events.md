# Eventos internos del pipeline — Precios Tandil

Cola: pg-boss sobre PostgreSQL. Todos los eventos llevan `runId` y `ts`.

## Ingesta

| Evento | Payload mínimo | Consumidor |
|---|---|---|
| `ingest.run.started` | runId, storeSlug, trigger(cron\|manual) | metrics |
| `ingest.snapshot.captured` | runId, snapshot | normalizer |
| `ingest.snapshot.rejected` | runId, externalId, reason | metrics, report |
| `ingest.run.completed` | runId, status(success\|partial\|failed), counters | reports, alerts |
| `ingest.quarantine.entered/exited` | storeSlug, reason, consecutiveFailures | alerts |

## Normalización / Matching

| Evento | Payload | Consumidor |
|---|---|---|
| `match.ean.linked` | storeSkuId, productId | aggregates |
| `match.semantic.auto` | storeSkuId, productId, score | aggregates |
| `match.pending_review` | storeSkuId, candidates[], scores | admin queue |
| `match.conflict.ean` | declaredEan, conflictingSkuIds | admin queue |

## Precios / Deals

| Evento | Payload | Consumidor |
|---|---|---|
| `price.suspect.flagged` | storeSkuId, prevPrice, newPrice | confirmación 2ª captura |
| `aggregates.refreshed` | productId, refreshedAt | cache invalidation |
| `deal.detected` | productId, discountPct, evidence | deal queue (admin) |
| `deal.published/rejected` | candidateId, by | web home badge |

## Alertas operativas (Constitución VIII)

- Adaptador en cuarentena > 24 h → notificar canal ops.
- Tasa de rechazo de corrida > 20 % → notificar.
- Frescura > 72 h por tienda → notificar.
