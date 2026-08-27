import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';

async function verifyAdmin(request: Request): Promise<{ label: string } | Response> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Token Bearer ausente' } },
      { status: 401 },
    );
  }
  const token = header.slice('Bearer '.length).trim();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const db = getDb();
  const row = await db
    .selectFrom('admin_token')
    .select(['label'])
    .where('token_hash', '=', tokenHash)
    .where('revoked_at', 'is', null)
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Token invalido o revocado' } },
      { status: 401 },
    );
  }
  return { label: row.label };
}

export async function GET(request: Request) {
  const auth = await verifyAdmin(request);
  if (auth instanceof Response) return auth;
  try {
    const db = getDb();
    const rows = await sql<{
      run_id: string;
      store_slug: string;
      store_name: string;
      started_at: Date;
      finished_at: Date | null;
      status: string;
      skus_captured: number;
      skus_rejected: number;
      http_errors: number;
      quarantined: boolean;
      correlation_id: string;
    }>`
      select rr.run_id, s.slug as store_slug, s.name as store_name,
             rr.started_at, rr.finished_at, rr.status, rr.skus_captured,
             rr.skus_rejected, rr.http_errors, rr.quarantined, rr.correlation_id
      from run_report rr join store s on s.id = rr.store_id
      order by rr.started_at desc limit 100
    `.execute(db);

    return NextResponse.json({
      runs: rows.rows.map((r) => ({
        run_id: r.run_id,
        store_slug: r.store_slug,
        store_name: r.store_name,
        started_at: new Date(r.started_at).toISOString(),
        finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
        status: r.status,
        skus_captured: Number(r.skus_captured),
        skus_rejected: Number(r.skus_rejected),
        http_errors: Number(r.http_errors),
        quarantined: Boolean(r.quarantined),
        correlation_id: r.correlation_id,
      })),
    });
  } catch (err) {
    console.error('[admin/ingest/runs GET]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
