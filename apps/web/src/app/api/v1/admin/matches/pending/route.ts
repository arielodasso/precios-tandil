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
      match_id: number;
      store_sku_id: number;
      product_slug: string;
      product_name: string;
      sku_name: string;
      sku_ean: string | null;
      method: string;
    }>`
      select ml.id::int as match_id, ml.store_sku_id, p.slug as product_slug,
             p.canonical_name as product_name, ss.raw_description as sku_name,
             ss.declared_ean as sku_ean, ml.method
      from match_link ml
      join product p on p.id = ml.product_id
      join store_sku ss on ss.id = ml.store_sku_id
      where ml.status = 'pending_review'
      order by ml.method asc, p.slug asc limit 200
    `.execute(db);

    return NextResponse.json({
      matches: rows.rows.map((r) => ({
        id: Number(r.match_id),
        store_sku_id: Number(r.store_sku_id),
        product_slug: r.product_slug,
        product_name: r.product_name,
        sku_name: r.sku_name,
        sku_ean: r.sku_ean ?? null,
        method: r.method,
      })),
    });
  } catch (err) {
    console.error('[admin/matches GET]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
