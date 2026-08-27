import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const db = getDb();
    const status = new URL(request.url).searchParams.get('status') ?? 'published';
    if (status !== 'published') {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_query',
            message: "Solo se permite status='published' en el endpoint publico",
          },
        },
        { status: 400 },
      );
    }

    const rows = await sql<{
      product_slug: string;
      product_name: string;
      image_url: string | null;
      best_store_slug: string | null;
      best_price: string | number | null;
      discount_pct: string | number;
      badge: string;
      published_at: Date;
      expires_at: Date | null;
    }>`
      select p.slug as product_slug, p.canonical_name as product_name, p.image_url,
             pa.best_store_id, pa.best_price, dc.discount_pct, dp.badge,
             dp.published_at, dp.expires_at, s.slug as best_store_slug
      from deal_publication dp
      join deal_candidate dc on dc.id = dp.candidate_id and dc.status = 'published'
      join product p on p.id = dc.product_id
      left join price_aggregate pa on pa.product_id = p.id
      left join store s on s.id = pa.best_store_id
      where (dp.expires_at is null or dp.expires_at > now())
      order by dc.discount_pct desc, dp.published_at desc
      limit 50
    `.execute(db);

    const deals = rows.rows.map((r) => ({
      slug: r.product_slug,
      name: r.product_name,
      image_url: r.image_url ?? null,
      store_slug: r.best_store_slug ?? null,
      price: r.best_price == null ? null : Number(r.best_price),
      discount_pct: Number(r.discount_pct),
      badge: r.badge,
      published_at: new Date(r.published_at).toISOString(),
      expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    }));

    return NextResponse.json({ deals });
  } catch (err) {
    console.error('[deals]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
