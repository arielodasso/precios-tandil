import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';
import { resolveCbaBasket } from '@/lib/cba';

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

    const resolved = await resolveCbaBasket(db);
    if (resolved.length === 0) {
      return NextResponse.json({ store_slug: slug, products: [] });
    }
    const payload = JSON.stringify(
      resolved.map((r) => ({
        productId: r.productId,
        key: r.key,
        label: r.label,
        rubric: r.rubric,
      })),
    );

    const rows = await sql<{
      key: string;
      label: string;
      rubric: string;
      slug: string;
      name: string;
      brand: string | null;
      price: string | null;
      ref_price: string | null;
      is_missing: boolean;
    }>`
      with items as (
        select (i.value->>'productId')::int as product_id,
               i.value->>'key' as key,
               i.value->>'label' as label,
               i.value->>'rubric' as rubric
        from jsonb_array_elements(${payload}::jsonb) as i(value)
      ),
      prices as (
        select ml.product_id, ss.store_id, min(pr.price_amount::numeric) as price
        from match_link ml
        join store_sku ss on ss.id = ml.store_sku_id and ss.is_active
        join price_record pr on pr.store_sku_id = ss.id and pr.is_suspect = false
          and pr.price_amount::numeric >= 500
          and pr.captured_at >= now() - interval '7 days'
        where ml.status in ('auto', 'confirmed')
          and ml.product_id in (select product_id from items)
        group by ml.product_id, ss.store_id
      ),
      prod_ref as (
        select product_id, avg(price) as ref_price
        from prices group by product_id
      )
      select
        it.key, it.label, it.rubric,
        p.slug, p.canonical_name as name, p.brand,
        st.price::numeric::text as price,
        pr.ref_price::numeric::text as ref_price,
        (st.price is null) as is_missing
      from items it
      join product p on p.id = it.product_id
      join prod_ref pr on pr.product_id = p.id
      left join prices st on st.product_id = p.id and st.store_id = ${storeId}::integer
      order by it.rubric asc, it.label asc
    `.execute(db);

    return NextResponse.json({
      store_slug: slug,
      products: rows.rows.map((r) => ({
        key: r.key,
        label: r.label,
        rubric: r.rubric,
        slug: r.slug,
        name: r.name,
        brand: r.brand,
        price: r.price === null ? null : Number(r.price),
        ref_price: r.ref_price === null ? null : Number(r.ref_price),
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
