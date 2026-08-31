/**
 * T067b — Recrea la serie diaria para excluir enlaces pendientes de revisión:
 * solo emparejamientos 'auto' o 'confirmed'. Esto evita que precios de
 * productos dudosos (potencialmente de otra marca/medida) entren en historial.
 */
export async function up(pgm) {
  await pgm.sql(`drop materialized view if exists daily_series;`);
  await pgm.sql(`
    create materialized view daily_series as
    select ml.product_id,
           (pr.captured_at at time zone 'utc')::date as day,
           min(pr.price_amount)::numeric(12,2) as min_price,
           round(avg(pr.price_amount)::numeric, 2) as avg_price,
           count(*)::int as records_count
    from price_record pr
    join store_sku ss on ss.id = pr.store_sku_id
    join match_link ml on ml.store_sku_id = ss.id
      and ml.status in ('auto', 'confirmed')
    where pr.is_suspect = false
    group by ml.product_id, (pr.captured_at at time zone 'utc')::date;
  `);
  await pgm.sql(`
    create unique index ux_daily_series_product_day on daily_series (product_id, day);
    create index idx_daily_series_product on daily_series (product_id, day desc);
  `);
}

export async function down(pgm) {
  await pgm.sql(`drop materialized view if exists daily_series;`);
}
