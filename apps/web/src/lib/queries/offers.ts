import { sql, type Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import type { CardOffer } from '@/lib/types';

interface OfferRow {
  product_id: string | number;
  store: string;
  store_name: string;
  price: string | number | null;
  source_url: string | null;
}

/**
 * Devuelve, por producto, el último precio de CADA fuente activa
 * (store_name + precio + link a la publicación de origen). Las fuentes que
 * no tienen el producto relevado (sin precio en el rango de frescura)
 * aparecen igual con price = null para que la tarjeta muestre "—".
 */
export async function loadOffersByProduct(
  db: Kysely<DB>,
  productIds: number[],
): Promise<Map<number, CardOffer[]>> {
  const byProduct = new Map<number, CardOffer[]>();
  if (productIds.length === 0) return byProduct;

  const idList = [...new Set(productIds)].join(', ');

  const rows = await sql<OfferRow>`
    select latest.product_id,
           s.slug as store,
           s.name as store_name,
           latest.price_amount::float8 as price,
           latest.source_url
    from product p
    cross join store s
    left join lateral (
      select pr.price_amount, pr.source_url
      from price_record pr
      join store_sku ss on ss.id = pr.store_sku_id
      join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto', 'confirmed')
      where ml.product_id = p.id
        and ss.store_id = s.id
        and pr.is_suspect = false
        and pr.price_amount::numeric >= 500
      order by pr.captured_at desc
      limit 1
    ) latest on true
    where p.id in (${sql.raw(idList)})
      and s.is_active = true
    order by p.id, latest.price_amount asc nulls last, s.name asc
  `.execute(db);

  for (const row of rows.rows) {
    const pid = Number(row.product_id);
    const list = byProduct.get(pid) ?? [];
    list.push({
      store: row.store,
      store_name: row.store_name,
      price: row.price === null || row.price === undefined ? null : Number(row.price),
      source_url: row.source_url ?? null,
    });
    byProduct.set(pid, list);
  }

  return byProduct;
}
