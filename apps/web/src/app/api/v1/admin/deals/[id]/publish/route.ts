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

    const body = (await request.json().catch(() => ({}))) as {
      badge?: string;
      expires_at?: string;
    };

    const updated = await sql<{ id: number; product_id: string; status: string }>`
      update deal_candidate set status = 'published'
      where id = ${id} and status = 'pending'
      returning id::int, product_id, status
    `.execute(db);
    const row = updated.rows[0];
    if (!row) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Candidato ${id} no existe o no esta pendiente` } },
        { status: 404 },
      );
    }

    const badge = body.badge === 'gold' ? 'gold' : 'green';
    const expiresAt = body.expires_at
      ? new Date(body.expires_at)
      : new Date(Date.now() + 30 * 86_400_000);
    if (Number.isNaN(expiresAt.getTime())) {
      return NextResponse.json(
        { error: { code: 'invalid_query', message: 'expires_at invalido' } },
        { status: 400 },
      );
    }

    await sql`
      insert into deal_publication (candidate_id, published_by, published_at, badge, expires_at)
      values (${id}, ${auth.label}, now(), ${badge}, ${expiresAt})
    `.execute(db);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/deals publish]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
