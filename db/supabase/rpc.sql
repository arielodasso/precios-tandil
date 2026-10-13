-- =============================================================================
-- Precios Tandil — RPCs para la SPA (Lovable)
-- =============================================================================
-- Lo que no se puede expresar como SELECT simple sobre las vistas:
--   * busqueda full-text (tsvector + trigram), como hoy hace /api/v1/search
--   * detalle de producto con sus ofertas por tienda y agregados
--   * historial diario por ventana
--   * reporte/lectura del contador de ahorro (unica escritura desde el cliente)
--
-- Todas son `security definer` para que `anon` las ejecute aunque RLS bloquee
-- el acceso directo a las tablas base. Correr DESPUES de schema/views/rls.
-- =============================================================================

-- Búsqueda de productos (equivale a apps/api/src/routes/v1/search.ts)
create or replace function search_products(
  p_q text,
  p_category text default null,
  p_stores text[] default null,
  p_limit int default 8,
  p_offset int default 0
)
returns table (
  slug text,
  name text,
  brand text,
  category text,
  image_url text,
  best_price numeric,
  stores_count smallint,
  freshest_captured_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with avail as (
    select distinct ml.product_id
    from price_record pr
    join store_sku ss on ss.id = pr.store_sku_id
    join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto', 'confirmed')
    join store s on s.id = ss.store_id
    where pr.is_suspect = false
      and pr.captured_at >= now() - interval '7 days'
      and (p_stores is null or s.slug = any (p_stores))
  ),
  cat as (
    select path from category
    where p_category is not null and (slug = p_category or path = p_category)
    order by case when path = p_category then 0 else 1 end
    limit 1
  )
  select p.slug,
         p.canonical_name,
         p.brand,
         c.path,
         p.image_url,
         pa.best_price::numeric,
         pa.stores_count,
         pa.best_captured_at
  from product p
  join price_aggregate pa on pa.product_id = p.id
  left join category c on c.id = p.category_id
  where (
      p.search_vector @@ websearch_to_tsquery('spanish', unaccent(p_q))
      or p.canonical_name % unaccent(p_q)
      or unaccent(coalesce(p.canonical_name, '')) ilike '%' || unaccent(p_q) || '%'
      or unaccent(coalesce(p.brand, '')) ilike '%' || unaccent(p_q) || '%'
    )
    and exists (select 1 from avail a where a.product_id = p.id)
    and pa.stores_count >= 2
    and pa.best_price::numeric >= 500
    and (
      p_category is null
      or c.path = (select path from cat)
      or c.path like (select path from cat) || '/%'
    )
  order by greatest(
             ts_rank_cd(p.search_vector, websearch_to_tsquery('spanish', unaccent(p_q))),
             similarity(p.canonical_name, unaccent(p_q))
           ) desc,
           pa.best_price asc
  limit greatest(1, least(coalesce(p_limit, 8), 20))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- Detalle de producto (equivale a apps/api/src/routes/v1/products.ts)
create or replace function get_product_detail(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with prod as (
    select p.*, c.path as category_path
    from product p
    left join category c on c.id = p.category_id
    join price_aggregate pa on pa.product_id = p.id
    where p.slug = p_slug
      and pa.stores_count >= 2
      and pa.best_price::numeric >= 500
    limit 1
  ),
  offs as (
    select distinct on (ss.store_id)
           s.slug as store,
           s.name as store_name,
           pr.price_amount::numeric(12,2) as price,
           pr.unit_price,
           (pr.list_or_promo = 'promo') as promo,
           pr.source_url,
           pr.captured_at
    from price_record pr
    join store_sku ss on ss.id = pr.store_sku_id
    join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto', 'confirmed')
    join store s on s.id = ss.store_id and s.is_active = true
    where ml.product_id = (select id from prod)
      and pr.is_suspect = false
    order by ss.store_id, pr.captured_at desc,
             case when pr.list_or_promo = 'promo' then 0 else 1 end,
             pr.price_amount asc
  )
  select case when (select id from prod) is null then null else
    jsonb_build_object(
      'slug', (select slug from prod),
      'name', (select canonical_name from prod),
      'brand', (select brand from prod),
      'ean', (select ean from prod),
      'unit', case
                when (select unit_amount from prod) is not null
                 and (select unit_type from prod) is not null
                then jsonb_build_object(
                  'amount', (select unit_amount from prod),
                  'type', (select unit_type from prod))
                else null end,
      'category', (select category_path from prod),
      'image_url', (select image_url from prod),
      'offers', coalesce(
        (select jsonb_agg(to_jsonb(offs) order by price) from offs), '[]'::jsonb),
      'aggregate', (
        select jsonb_build_object(
          'best_price', pa.best_price,
          'stores_count', pa.stores_count,
          'pct_change_7d', pa.pct_change_7d,
          'pct_change_24h', pa.pct_change_24h,
          'min_30d', pa.min_30d,
          'min_90d', pa.min_90d,
          'avg_30d', pa.avg_30d)
        from price_aggregate pa where pa.product_id = (select id from prod)),
      'deal_badge', (
        select dp.badge from deal_publication dp
        join deal_candidate dc on dc.id = dp.candidate_id
        where dc.product_id = (select id from prod)
          and dc.status = 'published'
          and (dp.expires_at is null or dp.expires_at > now())
        order by dp.published_at desc limit 1)
    )
  end;
$$;

-- Historial diario (equivale a apps/api/src/routes/v1/history.ts)
create or replace function product_history(p_slug text, p_window text default '30')
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with prod as (
    select p.id from product p
    where p.slug = p_slug
      and exists (select 1 from price_aggregate pa where pa.product_id = p.id)
    limit 1
  ),
  series as (
    select ds.day, ds.min_price, ds.avg_price
    from daily_series ds
    where ds.product_id = (select id from prod)
      and (
        p_window = 'all'
        or ds.day >= now()::date - case when p_window = '90' then 90 else 30 end
      )
    order by ds.day asc
  )
  select case when (select id from prod) is null then null else
    jsonb_build_object(
      'product_slug', p_slug,
      'window', p_window,
      'series', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'date', day, 'min_price', min_price, 'avg_price', avg_price))
           from series), '[]'::jsonb)
    )
  end;
$$;

-- Reporte de ahorro (escritura anon, upsert monótono)
create or replace function report_savings(
  p_device_id text,
  p_savings numeric,
  p_items int
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into user_savings (device_id, savings_amount, item_count, updated_at)
  values (
    left(p_device_id, 128),
    greatest(coalesce(p_savings, 0), 0),
    greatest(coalesce(p_items, 0), 0),
    now()
  )
  on conflict (device_id) do update set
    savings_amount = greatest(excluded.savings_amount, user_savings.savings_amount),
    item_count = excluded.item_count,
    updated_at = now();
$$;

-- Total de ahorro agregado
create or replace function savings_total()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'totalSavings', coalesce(round(sum(savings_amount)::numeric, 0), 0),
    'contributors', count(*) filter (where device_id <> '__base_total__')
  )
  from user_savings;
$$;

-- Permisos de ejecución para la SPA
grant execute on function search_products(text, text, text[], int, int) to anon, authenticated;
grant execute on function get_product_detail(text) to anon, authenticated;
grant execute on function product_history(text, text) to anon, authenticated;
grant execute on function report_savings(text, numeric, int) to anon, authenticated;
grant execute on function savings_total() to anon, authenticated;
