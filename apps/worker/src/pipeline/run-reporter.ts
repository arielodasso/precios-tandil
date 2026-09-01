import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Logger } from 'pino';
import type { DB, RunStatus } from '@precios/shared';

/**
 * pg serializa arrays de JS como literales de array de Postgres, no como JSON,
 * lo que rompe al insertar en columnas jsonb. Este helper serializa explícitamente.
 */
function toJsonb(value: unknown): RawBuilder<unknown[]> {
  return sql<unknown[]>`${JSON.stringify(value)}::jsonb`;
}

const QUARANTINE_THRESHOLD = 3;
const QUARANTINE_HOURS = 24;
const MAX_ERRORS_SAMPLE = 20;

export interface RunReporterInfo {
  runId: string;
  correlationId: string;
  storeId: number;
}

export class RunReporter {
  private captured = 0;
  private rejected = 0;
  private httpErrors = 0;
  private errorsSample: unknown[] = [];

  constructor(
    private readonly db: Kysely<DB>,
    private readonly logger: Logger,
    private readonly info: RunReporterInfo,
  ) {}

  async start(): Promise<void> {
    await this.db
      .insertInto('run_report')
      .values({
        run_id: this.info.runId,
        store_id: this.info.storeId,
        started_at: new Date(),
        finished_at: null,
        status: 'running',
        skus_captured: 0,
        skus_rejected: 0,
        http_errors: 0,
        quarantined: false,
        errors_sample: toJsonb([]),
        correlation_id: this.info.correlationId,
      })
      .execute();
    this.logger.info({ event: 'ingest.run.started', runId: this.info.runId }, 'corrida iniciada');
  }

  countCaptured(n = 1): void {
    this.captured += n;
  }

  countRejected(reason: string, externalId: string): void {
    this.rejected++;
    this.pushSample({ kind: 'rejected', reason, externalId });
    this.logger.warn(
      { event: 'ingest.snapshot.rejected', reason, externalId },
      'snapshot rechazado',
    );
  }

  countHttpError(err: unknown): void {
    this.httpErrors++;
    this.pushSample({ kind: 'http_error', message: String(err) });
  }

  private pushSample(entry: unknown): void {
    if (this.errorsSample.length < MAX_ERRORS_SAMPLE) this.errorsSample.push(entry);
  }

  get stats(): { captured: number; rejected: number; httpErrors: number } {
    return { captured: this.captured, rejected: this.rejected, httpErrors: this.httpErrors };
  }

  async finish(status: RunStatus): Promise<{ quarantined: boolean }> {
    const store = await this.db
      .selectFrom('store')
      .select(['config'])
      .where('id', '=', this.info.storeId)
      .executeTakeFirstOrThrow();

    const previousFailures = store.config.consecutiveFailures ?? 0;
    const failures = status === 'failed' ? previousFailures + 1 : 0;
    let quarantined = false;
    const config = { ...store.config, consecutiveFailures: failures };

    if (failures >= QUARANTINE_THRESHOLD) {
      quarantined = true;
      config.quarantinedUntil = new Date(Date.now() + QUARANTINE_HOURS * 3_600_000).toISOString();
      this.logger.error(
        { event: 'ingest.quarantine.entered', failures },
        `adaptador en cuarentena por ${QUARANTINE_HOURS}h`,
      );
    } else if (previousFailures >= QUARANTINE_THRESHOLD && status !== 'failed') {
      this.logger.info({ event: 'ingest.quarantine.exited' }, 'adaptador sale de cuarentena');
    }

    await this.db
      .updateTable('run_report')
      .set({
        finished_at: new Date(),
        status,
        skus_captured: this.captured,
        skus_rejected: this.rejected,
        http_errors: this.httpErrors,
        quarantined,
        errors_sample: toJsonb(this.errorsSample),
      })
      .where('run_id', '=', this.info.runId)
      .execute();

    await this.db
      .updateTable('store')
      .set({ config })
      .where('id', '=', this.info.storeId)
      .execute();

    this.logger.info(
      {
        event: 'ingest.run.completed',
        status,
        captured: this.captured,
        rejected: this.rejected,
        httpErrors: this.httpErrors,
        quarantined,
      },
      'corrida finalizada',
    );

    return { quarantined };
  }
}

export function resolveStatus(input: {
  captured: number;
  rejected: number;
  httpErrors: number;
  iteratorFailed: boolean;
}): RunStatus {
  if (input.captured === 0 && (input.iteratorFailed || input.httpErrors > 0)) return 'failed';
  if (input.rejected > 0 || input.httpErrors > 0 || input.iteratorFailed) return 'partial';
  return 'success';
}
