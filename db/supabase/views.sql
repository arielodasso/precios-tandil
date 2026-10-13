-- =============================================================================
-- Precios Tandil — vistas de lectura para la SPA (Lovable)
-- =============================================================================
-- Proyecta el modelo normalizado en las formas que hoy consume la web
-- (apps/web/src/lib/queries/*). Lovable lee SOLO estas vistas.
--
-- En Supabase los views corren con privilegios del owner por defecto
-- (security_invoker = false), asi que `anon` puede leerlos aunque no tenga
-- acceso a las tablas base. Ver supabase_rls.sql para los grants.
-- =============================================================================

-- Fuentes / frescura por tienda
create or replace view v_stores as
select s.slug,
       s.name,
       s.is_active,
       (select max(pr.captured_at)
          from price_record pr
          join store_sku ss on ss.id = pr.store_sku_id
         where ss.store_id = s.id) as last_captured_at
from store s;

-- Arbol de categorias con conteo directo de productos
create or replace view v_categories as
select c.id,
       c.slug,
       c.name,
       c.parent_id,
       c.path,
       (select count(*)::int from product p where p.category_id = c.id) as direct_product_count
from category c;

-- Producto publicado + su agregado (detalle y listados)
create or replace view v_productos as
select p.id,
       p.slug,
       p.canonical_name as name,
       p.brand,
       p.ean,
       p.unit_amount,
       p.unit_type,
       p.image_url,
       c.path as category_path,
       pa.best_store_id,
       s.slug as best_store_slug,
       pa.best_price,
       pa.best_captured_at,
       pa.stores_count,
       pa.pct_change_7d,
       pa.pct_change_24h,
       pa.min_30d,
       pa.min_90d,
       pa.min_all_time,
       pa.avg_30d,
       pa.refreshed_at
from product p
join price_aggregate pa on pa.product_id = p.id
left join category c on c.id = p.category_id
left join store s on s.id = pa.best_store_id
where pa.stores_count >= 2
  and pa.best_price::numeric >= 500;

-- Ultimo precio por (producto, tienda) sobre matches validos
create or replace view v_offers as
select distinct on (ml.product_id, ss.store_id)
       ml.product_id,
       p.slug as product_slug,
       s.slug as store_slug,
       s.name as store_name,
       pr.price_amount::numeric(12,2) as price,
       pr.unit_price,
       pr.list_or_promo,
       (pr.list_or_promo = 'promo') as promo,
       pr.source_url,
       pr.captured_at
from price_record pr
join store_sku ss on ss.id = pr.store_sku_id
join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto', 'confirmed')
join product p on p.id = ml.product_id
join store s on s.id = ss.store_id and s.is_active = true
where pr.is_suspect = false
  and pr.price_amount::numeric >= 500
order by ml.product_id, ss.store_id,
         pr.captured_at desc,
         case when pr.list_or_promo = 'promo' then 0 else 1 end,
         pr.price_amount asc;

-- Serie diaria por producto (min/avg)
create or replace view v_price_history as
select ds.product_id,
       p.slug as product_slug,
       ds.day,
       ds.min_price,
       ds.avg_price,
       ds.records_count
from daily_series ds
join product p on p.id = ds.product_id;

-- Ofertas vigentes (pending o published)
create or replace view v_deals as
select distinct on (p.id)
       p.id as product_id,
       p.slug as product_slug,
       p.canonical_name as name,
       p.image_url,
       s.slug as best_store_slug,
       pa.best_price as price,
       pa.stores_count,
       dc.discount_pct,
       case when dp.badge is not null then dp.badge
            else case when dc.discount_pct >= 25 then 'gold' else 'green' end
       end as badge,
       coalesce(dp.published_at, dc.detected_at) as published_at,
       dp.expires_at
from deal_candidate dc
join product p on p.id = dc.product_id
left join deal_publication dp on dp.candidate_id = dc.id
join price_aggregate pa on pa.product_id = p.id
join store s on s.id = pa.best_store_id
where dc.status in ('pending', 'published')
  and pa.stores_count >= 2
  and pa.best_price::numeric >= 500
  and (dp.expires_at is null or dp.expires_at > now())
order by p.id, dc.discount_pct desc, dc.detected_at desc;
