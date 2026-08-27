import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const result = await sql<{
      slug: string;
      name: string;
      is_active: boolean;
      last_captured_at: Date | string | null;
    }>`
      select s.slug, s.name, s.is_active,
             (select max(pr.captured_at) from price_record pr
              join store_sku ss on ss.id = pr.store_sku_id where ss.store_id = s.id
             ) as last_captured_at
      from store s order by s.slug asc
    `.execute(db);

    const stores = result.rows.map((row) => {
      const last = row.last_captured_at ? new Date(row.last_captured_at) : null;
      const hours = last ? Math.floor((Date.now() - last.getTime()) / 3_600_000) : null;
      const status: 'sin_datos' | 'ok' | 'atrasada' | 'rancia' =
        hours === null ? 'sin_datos' : hours < 72 ? 'ok' : hours < 24 * 7 ? 'atrasada' : 'rancia';
      return {
        slug: row.slug,
        name: row.name,
        is_active: row.is_active,
        last_captured_at: last ? last.toISOString() : null,
        freshness_hours: hours,
        freshness_status: status,
      };
    });

    return NextResponse.json({ stores });
  } catch (err) {
    console.error('[stores]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
