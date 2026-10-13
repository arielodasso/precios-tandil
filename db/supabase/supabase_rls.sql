-- =============================================================================
-- Precios Tandil — RLS y grants para Supabase
-- =============================================================================
-- Objetivo: la SPA (anon) SOLO puede leer las vistas v_*. Las tablas internas
-- quedan inaccesibles por PostgREST. El worker/sync escribe con la conexion
-- directa del rol `postgres` (no pasa por RLS).
--
-- Correr DESPUES de schema.sql y views.sql, como rol `postgres`.
-- Los roles `anon` y `authenticated` son propios de Supabase.
-- =============================================================================

-- 1) RLS activado en todas las tablas internas => sin policies, acceso denegado.
do $$
declare
  t text;
  tables text[] := array[
    'store','category','product','store_sku','match_link','price_record',
    'price_correction','price_aggregate','run_report','deal_candidate',
    'deal_publication','admin_token','user_savings'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 2) Quitar el acceso directo que Supabase otorga por defecto a anon/auth.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on public.daily_series from anon, authenticated;

-- 3) Exponer unicamente las vistas de lectura.
grant select on
  public.v_stores,
  public.v_categories,
  public.v_productos,
  public.v_offers,
  public.v_price_history,
  public.v_deals
to anon, authenticated;

-- 4) (Opcional) El service_role siembra/administra el sync.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
