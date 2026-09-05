import { sql, type Kysely, type SqlBool } from 'kysely';
import type { DB } from '@precios/shared';
import { AppError } from '@precios/shared';

const FRESH_WINDOW_DAYS = 7;

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const toNumber = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getProductDetail(db: Kysely<DB>, slug: string) {
  const product = await db
    .selectFrom('product')
    .leftJoin('category', 'category.id', 'product.category_id')
    .innerJoin('price_aggregate as pa', 'pa.product_id', 'product.id')
    .select([
      'product.id',
      'product.slug',
      'product.canonical_name',
      'product.brand',
      'product.ean',
      'product.unit_amount',
      'product.unit_type',
      'product.image_url',
      'category.path as category_path',
    ])
    .where('product.slug', '=', slug)
    .where('pa.stores_count', '>=', 2)
    .where(sql<SqlBool>`pa.best_price::numeric >= 500`)
    .executeTakeFirst();

  if (!product) throw new AppError('not_found', `Producto no encontrado: ${slug}`);

  const offersResult = await sql<{
    store_slug: string;
    store_name: string;
    price: number;
    unit_price: number | null;
    list_or_promo: string;
    source_url: string;
    captured_at: Date | string;
  }>`
    select s.slug as store_slug, s.name as store_name,
           latest.price_amount::float8 as price, latest.unit_price::float8 as unit_price,
           latest.list_or_promo, latest.source_url, latest.captured_at
    from (
      select distinct on (ss.store_id)
             ss.store_id, pr.price_amount, pr.unit_price, pr.list_or_promo,
             pr.source_url, pr.captured_at
      from price_record pr
      join store_sku ss on ss.id = pr.store_sku_id
      join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto', 'confirmed')
      where ml.product_id = ${product.id} and pr.is_suspect = false and pr.price_amount::numeric >= 500
      order by ss.store_id, pr.captured_at desc,
               case when pr.list_or_promo = 'promo' then 0 else 1 end,
               pr.price_amount asc
    ) latest
    join store s on s.id = latest.store_id and s.is_active = true
    order by latest.price_amount asc
  `.execute(db);

  const now = Date.now();
  const staleThresholdMs = FRESH_WINDOW_DAYS * 24 * 3_600_000;

  const offers = offersResult.rows.map((row) => {
    const capturedMs = new Date(row.captured_at).getTime();
    const ageHours = Math.max(0, Math.floor((now - capturedMs) / 3_600_000));
    return {
      store: row.store_slug,
      store_name: row.store_name,
      price: round(row.price, 2),
      unit_price: row.unit_price === null ? null : round(row.unit_price, 3),
      promo: row.list_or_promo === 'promo',
      source_url: row.source_url,
      captured_at: new Date(row.captured_at).toISOString(),
      freshness_hours: ageHours,
      is_stale: now - capturedMs > staleThresholdMs,
    };
  });

  const freshOffers = offers.filter((o) => !o.is_stale);
  const aggregate = await db
    .selectFrom('price_aggregate')
    .select(['pct_change_7d', 'min_30d', 'min_90d'])
    .where('product_id', '=', product.id)
    .executeTakeFirst();

  let summary;
  if (freshOffers.length === 0) {
    summary = {
      best_store: null,
      best_price: null,
      worst_price: null,
      spread_pct: null,
      stores_count: 0,
      pct_change_7d: toNumber(aggregate?.pct_change_7d),
      min_30d: aggregate?.min_30d == null ? null : round(Number(aggregate.min_30d), 2),
      near_min_90d: false,
    };
  } else {
    const prices = freshOffers.map((o) => o.price);
    const bestPrice = Math.min(...prices);
    const worstPrice = Math.max(...prices);
    const bestOffer = freshOffers.find((o) => o.price === bestPrice)!;
    const min90 = toNumber(aggregate?.min_90d);
    summary = {
      best_store: bestOffer.store,
      best_price: bestPrice,
      worst_price: worstPrice,
      spread_pct: bestPrice > 0 ? round(((worstPrice - bestPrice) / bestPrice) * 100, 1) : null,
      stores_count: freshOffers.length,
      pct_change_7d: toNumber(aggregate?.pct_change_7d),
      min_30d: aggregate?.min_30d == null ? null : round(Number(aggregate.min_30d), 2),
      near_min_90d: min90 !== null && bestPrice <= min90 * 1.05,
    };
  }

  const dealResult = await sql<{ badge: string }>`
    select dp.badge from deal_publication dp
    join deal_candidate dc on dc.id = dp.candidate_id
    where dc.product_id = ${product.id} and dc.status = 'published'
      and (dp.expires_at is null or dp.expires_at > now())
    order by dp.published_at desc limit 1
  `.execute(db);

  const eanNumber = product.ean !== null && /^\d+$/.test(product.ean) ? Number(product.ean) : null;

  const response: Record<string, unknown> = {
    slug: product.slug,
    name: product.canonical_name,
    brand: product.brand,
    ean: eanNumber,
    unit:
      product.unit_amount === null || product.unit_type === null
        ? null
        : { amount: Number(product.unit_amount), type: product.unit_type },
    category: product.category_path,
    image_url: product.image_url,
    offers,
    summary,
    deal_badge: dealResult.rows[0]?.badge ?? null,
  };
  if (freshOffers.length === 0) {
    response.stale_notice = 'Este producto no tiene precios actualizados en las ultimas tiendas.';
  }
  return response;
}
