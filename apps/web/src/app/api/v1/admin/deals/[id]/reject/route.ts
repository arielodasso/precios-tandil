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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAdmin(request);
  if (auth instanceof Response) return auth;
  try {
    const db = getDb();
    const id = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { error: { code: 'invalid_query', message: 'id invalido' } },
        { status: 400 },
      );
    }

    const rejectedUntil = new Date(Date.now() + 14 * 86_400_000);
    const result = await sql<{ id: number }>`
      update deal_candidate
      set status = 'rejected', rejected_until = ${rejectedUntil}
      where id = ${id} and status in ('pending', 'published')
      returning id::int
    `.execute(db);

    if (!result.rows[0]) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Candidato ${id} no existe o ya fue cerrado` } },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, rejected_until: rejectedUntil.toISOString() });
  } catch (err) {
    console.error('[admin/deals reject]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
