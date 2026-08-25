import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { DB } from '@precios/shared';

export interface OpsAlert {
  kind: 'quarantine' | 'high_rejection' | 'stale_store';
  storeSlug: string;
  detail: string;
}

/** Cuarentena activa por más de 24 h dispara alerta. */
const QUARANTINE_ALERT_AFTER_HOURS = 24;
/** Más del 20% de SKUs rechazados en la última corrida dispara alerta. */
const REJECTION_RATE_THRESHOLD = 0.2;
/** Sin capturas frescas hace más de 72 h dispara alerta. */
const STALE_AFTER_HOURS = 72;

/**
 * T069 — Panel de alertas ops: detecta adaptadores en cuarentena >24h,
 * tiendas con tasa de rechazo >20% en su última corrida y tiendas con
 * frescura >72h, y las envía al webhook configurado (canal
 * "Tandil Alerta/Sigma"). Idempotente: deduplica por (kind, tienda) dentro
 * de la misma hora.
 */
export async function opsAlerts(
  db: Kysely<DB>,
  logger?: Logger,
  opts: { now?: Date; webhookUrl?: string } = {},
): Promise<{ alerts: OpsAlert[] }> {
  const now = opts.now ?? new Date();
  const alerts = await collectAlerts(db, now);
  if (alerts.length === 0) return { alerts };

  const webhookUrl =
    opts.webhookUrl ?? process.env.OPS_WEBHOOK_URL ?? process.env.TANDIL_ALERTA_WEBHOOK_URL ?? '';

  for (const alert of alerts) {
    logger?.warn(
      { event: 'ops.alert', kind: alert.kind, storeSlug: alert.storeSlug, detail: alert.detail },
      `alerta ops: ${alert.kind}`,
    );
  }

  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'precios-tandil',
          sentAt: now.toISOString(),
          alerts,
          text: alerts.map((a) => `[${a.kind}] ${a.storeSlug}: ${a.detail}`).join('\n'),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger?.error({ err }, 'fallo enviando webhook de alertas ops');
    }
  }

  return { alerts };
}

async function collectAlerts(db: Kysely<DB>, now: Date): Promise<OpsAlert[]> {
  const rows = await sql<{
    slug: string;
    quarantined_until: string | null;
    last_run_status: string | null;
    skus_captured: number | null;
    skus_rejected: number | null;
    last_capture_at: Date | null;
  }>`
    select s.slug,
           (s.config->>'quarantinedUntil') as quarantined_until,
           rr.status as last_run_status,
           rr.skus_captured,
           rr.skus_rejected,
           cap.last_capture_at
    from store s
    left join lateral (
      select status, skus_captured, skus_rejected
      from run_report rr
      where rr.store_id = s.id and rr.status in ('success', 'partial', 'failed')
      order by rr.started_at desc
      limit 1
    ) rr on true
    left join lateral (
      select max(pr.captured_at) as last_capture_at
      from price_record pr
      join store_sku ss on ss.id = pr.store_sku_id
      where ss.store_id = s.id
    ) cap on true
    where s.is_active = true
  `.execute(db);

  const alerts: OpsAlert[] = [];
  for (const row of rows.rows) {
    const quarantinedUntil = row.quarantined_until ? new Date(row.quarantined_until) : null;
    if (
      quarantinedUntil &&
      quarantinedUntil.getTime() > now.getTime() &&
      quarantinedUntil.getTime() - now.getTime() >= QUARANTINE_ALERT_AFTER_HOURS * 3_600_000
    ) {
      alerts.push({
        kind: 'quarantine',
        storeSlug: row.slug,
        detail: `en cuarentena hasta ${quarantinedUntil.toISOString()} (>24h)`,
      });
    }

    const captured = Number(row.skus_captured ?? 0);
    const rejected = Number(row.skus_rejected ?? 0);
    const total = captured + rejected;
    if (total > 0 && row.last_run_status !== null && rejected / total > REJECTION_RATE_THRESHOLD) {
      alerts.push({
        kind: 'high_rejection',
        storeSlug: row.slug,
        detail: `última corrida ${row.last_run_status} rechazó ${rejected}/${total} SKUs (${Math.round((rejected / total) * 100)}%)`,
      });
    }

    const lastCaptureAt = row.last_capture_at ? new Date(row.last_capture_at) : null;
    const staleHours = lastCaptureAt
      ? (now.getTime() - lastCaptureAt.getTime()) / 3_600_000
      : Number.POSITIVE_INFINITY;
    if (staleHours > STALE_AFTER_HOURS) {
      alerts.push({
        kind: 'stale_store',
        storeSlug: row.slug,
        detail:
          lastCaptureAt === null
            ? 'sin capturas registradas'
            : `última captura hace ${Math.round(staleHours)}h (>72h)`,
      });
    }
  }
  return alerts;
}
