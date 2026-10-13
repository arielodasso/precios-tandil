-- =============================================================================
-- Precios Tandil - "serving": contrato plano que ya consume la SPA de Lovable
-- =============================================================================
-- La SPA (preciostandil.com) lee tablas planas (stores, categories, products,
-- offers, price_history, deals, cba_items) via supabase-js y llama a las RPC
-- report_savings() y savings_total(). Este archivo expone esas tablas planas
-- SOBRE la misma base normalizada del scraper (store, product, price_record...),
-- para no depender de Neon ni del endpoint /api/ingest.
--
-- Se aplica DESPUES de schema.sql / views.sql / supabase_rls.sql / rpc.sql.
--
-- Reutiliza la tabla normalizada public.user_savings (columna savings_amount)
-- para el contador; reemplaza las funciones report_savings/savings_total por
-- las firmas que espera la SPA. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tablas planas (mismo contrato que hoy: drizzle/migrations/0000_migration.sql)
-- -----------------------------------------------------------------------------
create table if not exists public.stores (
  id        smallint primary key,
  slug      text not null unique,
  name      text not null,
  base_url  text not null,
  is_active boolean not null default true
);

create table if not exists public.categories (
  id        integer primary key,
  slug      text not null unique,
  name      text not null,
  parent_id integer references public.categories(id),
  sort      integer not null default 0
);

create table if not exists public.products (
  id             bigint primary key,
  slug           text not null unique,
  canonical_name text not null,
  brand          text,
  ean            numeric(13),
  unit_amount    numeric(10,3),
  unit_type      text check (unit_type in ('kg','g','l','ml','un')),
  image_url      text,
  category_id    integer references public.categories(id),
  created_at     timestamptz not null default now()
);
create index if not exists idx_products_category on public.products (category_id);

create table if not exists public.offers (
  product_id  bigint not null references public.products(id) on delete cascade,
  store_id    smallint not null references public.stores(id),
  price       numeric(12,2) not null check (price > 0),
  source_url  text,
  captured_at timestamptz not null default now(),
  primary key (product_id, store_id)
);

create table if not exists public.price_history (
  product_id bigint not null references public.products(id) on delete cascade,
  day        date not null,
  min_price  numeric(12,2) not null,
  avg_price  numeric(12,2),
  primary key (product_id, day)
);

create table if not exists public.deals (
  id           bigint generated always as identity primary key,
  product_id   bigint not null references public.products(id) on delete cascade,
  store_id     smallint references public.stores(id),
  discount_pct numeric(6,2) not null,
  badge        text not null default 'Mejor Oportunidad de la Semana',
  status       text not null default 'pending' check (status in ('pending','published','rejected')),
  detected_at  timestamptz not null default now(),
  published_at timestamptz,
  expires_at   timestamptz
);

create table if not exists public.cba_items (
  key        text primary key,
  label      text not null,
  rubric     text not null,
  product_id bigint not null references public.products(id) on delete cascade,
  sort       integer not null default 0
);

-- -----------------------------------------------------------------------------
-- Grants + RLS (lectura anon; escritura solo service_role / conexion directa)
-- -----------------------------------------------------------------------------
grant select on public.stores, public.categories, public.products, public.offers,
  public.price_history, public.deals, public.cba_items to anon, authenticated;
grant all on public.stores, public.categories, public.products, public.offers,
  public.price_history, public.deals, public.cba_items to service_role;

alter table public.stores       enable row level security;
alter table public.categories   enable row level security;
alter table public.products     enable row level security;
alter table public.offers       enable row level security;
alter table public.price_history enable row level security;
alter table public.deals        enable row level security;
alter table public.cba_items    enable row level security;

drop policy if exists "public read stores" on public.stores;
drop policy if exists "public read categories" on public.categories;
drop policy if exists "public read products" on public.products;
drop policy if exists "public read offers" on public.offers;
drop policy if exists "public read history" on public.price_history;
drop policy if exists "public read published deals" on public.deals;
drop policy if exists "public read cba" on public.cba_items;

create policy "public read stores"     on public.stores       for select to anon, authenticated using (is_active);
create policy "public read categories" on public.categories   for select to anon, authenticated using (true);
create policy "public read products"   on public.products     for select to anon, authenticated using (true);
create policy "public read offers"     on public.offers       for select to anon, authenticated using (true);
create policy "public read history"    on public.price_history for select to anon, authenticated using (true);
create policy "public read published deals" on public.deals   for select to anon, authenticated using (status = 'published');
create policy "public read cba"        on public.cba_items    for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- Contador de ahorro: firmas que espera la SPA, sobre la tabla normalizada.
-- (El rpc.sql normalizado devuelve jsonb/{totalSavings}; aca se reemplaza.)
-- -----------------------------------------------------------------------------
drop function if exists public.savings_total();
drop function if exists public.report_savings(text, numeric, integer);

create or replace function public.report_savings(_device_id text, _savings numeric, _item_count integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if _device_id is null or length(_device_id) < 8 or length(_device_id) > 80 then return; end if;
  if _savings < 0 or _savings > 10000000 then return; end if;
  insert into public.user_savings(device_id, savings_amount, item_count, updated_at)
  values (_device_id, _savings, greatest(_item_count, 0), now())
  on conflict (device_id) do update
    set savings_amount = greatest(public.user_savings.savings_amount, excluded.savings_amount),
        item_count     = excluded.item_count,
        updated_at     = now();
end $$;

create or replace function public.savings_total()
returns table(total numeric, contributors bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(round(sum(savings_amount)::numeric, 0), 0),
         count(*) filter (where device_id <> '__base_total__')
  from public.user_savings;
$$;

grant execute on function public.report_savings(text, numeric, integer) to anon, authenticated;
grant execute on function public.savings_total() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Punto de partida del contador: acumulado historico real ($4.314.951).
-- El rpc normalizado excluye '__base_total__' del conteo de aportantes.
-- -----------------------------------------------------------------------------
insert into public.user_savings(device_id, savings_amount, item_count, updated_at)
values ('__base_total__', 4314951, 0, now())
on conflict (device_id) do nothing;
