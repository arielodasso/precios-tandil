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

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await verifyAdmin(_request);
  if (auth instanceof Response) return auth;
  try {
    const db = getDb();
    const { slug } = await params;

    const storeRows = await sql<{ id: number; is_active: boolean }>`
      select id::int, is_active from store where slug = ${slug} limit 1
    `.execute(db);
    const store = storeRows.rows[0];
    if (!store) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Tienda '${slug}' no encontrada` } },
        { status: 404 },
      );
    }
    if (!store.is_active) {
      return NextResponse.json(
        { error: { code: 'invalid_query', message: `Tienda '${slug}' esta desactivada` } },
        { status: 400 },
      );
    }

    const running = await sql<{ run_id: string }>`
      select run_id from run_report
      where store_id = ${store.id} and status = 'running' and started_at > now() - interval '4 hours'
      limit 1
    `.execute(db);
    if (running.rows.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: 'run_in_progress',
            message: 'Ya existe una corrida en curso para esta tienda',
          },
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: 'internal_error',
          message: 'Worker no disponible (PC apagada). Reinicia el worker para reintentar.',
        },
      },
      { status: 503 },
    );
  } catch (err) {
    console.error('[admin/ingest POST]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
