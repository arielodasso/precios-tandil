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
      candidate_id: number;
      product_slug: string;
      product_name: string;
      detected_at: Date;
      discount_pct: string | number;
      evidence: unknown;
      status: string;
      badge: string | null;
    }>`
      select dc.id as candidate_id, p.slug as product_slug, p.canonical_name as product_name,
             dc.detected_at, dc.discount_pct, dc.evidence, dc.status, dp.badge
      from deal_candidate dc
      join product p on p.id = dc.product_id
      left join deal_publication dp on dp.candidate_id = dc.id
      where dc.status in ('pending', 'published')
      order by case when dc.status = 'pending' then 0 else 1 end, dc.discount_pct desc
      limit 100
    `.execute(db);

    return NextResponse.json({
      candidates: rows.rows.map((r) => ({
        id: Number(r.candidate_id),
        product_slug: r.product_slug,
        product_name: r.product_name,
        detected_at: new Date(r.detected_at).toISOString(),
        discount_pct: Number(r.discount_pct),
        evidence: r.evidence,
        status: r.status,
        badge: r.badge ?? null,
      })),
    });
  } catch (err) {
    console.error('[admin/deals GET]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
