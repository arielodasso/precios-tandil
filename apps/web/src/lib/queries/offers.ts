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
 * Devuelve, por producto, el último precio de cada fuente activa
 * (store_name + precio + link a la publicación de origen), ordenados de
 * menor a mayor precio. Se usa para listar todos los precios en cada
 * tarjeta de producto (no solo el mejor).
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
    from (
      select distinct on (ss.store_id, ml.product_id)
             ml.product_id, ss.store_id, pr.price_amount, pr.source_url
      from price_record pr
      join store_sku ss on ss.id = pr.store_sku_id
      join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto', 'confirmed')
      where ml.product_id in (${sql.raw(idList)})
        and pr.is_suspect = false
        and pr.price_amount::numeric >= 500
      order by ml.product_id, ss.store_id, pr.captured_at desc
    ) latest
    join store s on s.id = latest.store_id and s.is_active = true
    order by latest.product_id, latest.price_amount asc
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
