import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const db = getDb();
    const { slug } = await params;

    const store = await sql<{ id: string }>`
      select id::text as id from store where slug = ${slug} and is_active limit 1
    `.execute(db);
    const storeId = store.rows[0]?.id;
    if (!storeId) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Tienda no encontrada: ${slug}` } },
        { status: 404 },
      );
    }

    const rows = await sql<{
      slug: string;
      name: string;
      brand: string | null;
      price: string | null;
      ref_price: string;
      is_missing: boolean;
    }>`
      with prices as (
        select ml.product_id, ss.store_id, min(pr.price_amount) as price
        from match_link ml
        join store_sku ss on ss.id = ml.store_sku_id and ss.is_active
        join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
          and pr.captured_at >= now() - interval '7 days'
        where ml.status in ('auto', 'confirmed')
        group by ml.product_id, ss.store_id
      ),
      presence as (
        select product_id, count(distinct store_id) as n
        from prices group by product_id
      ),
      comparable as (select product_id from presence where n >= 2),
      prod_ref as (
        select pric.product_id, avg(pric.price) as ref_price
        from prices pric
        join comparable c on c.product_id = pric.product_id
        group by pric.product_id
      )
      select
        p.slug, p.canonical_name as name, p.brand,
        st.price::numeric::text as price,
        pr.ref_price::numeric::text as ref_price,
        st.price is null as is_missing
      from prod_ref pr
      join product p on p.id = pr.product_id
      left join prices st on st.product_id = pr.product_id and st.store_id = ${storeId}::integer
      order by p.canonical_name asc
    `.execute(db);

    return NextResponse.json({
      store_slug: slug,
      products: rows.rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        brand: r.brand,
        price: r.price === null ? null : Number(r.price),
        ref_price: Number(r.ref_price),
        is_missing: r.is_missing,
      })),
    });
  } catch (err) {
    console.error('[admin/basket]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
