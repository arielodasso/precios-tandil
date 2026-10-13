-- =============================================================================
-- Precios Tandil — schema consolidado para Supabase
-- =============================================================================
-- Generado a partir de db/migrations/0001..0010. Aplica TODO de una sola vez.
--
-- Alternativa equivalente: apuntar DATABASE_URL a Supabase y correr
--   pnpm --filter @precios/db migrate && pnpm --filter @precios/db seed
-- (mismas migraciones, fuente de verdad). Este archivo existe para poder
-- aplicar el schema con un solo `psql -f` o pegarlo en el SQL Editor.
--
-- Correr como el rol `postgres` del proyecto Supabase.
-- Extensiones en `public` para que los tipos (citext) resuelvan sin tocar el
-- search_path; todas estan soportadas por Supabase.
-- =============================================================================

create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists citext;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- store
-- -----------------------------------------------------------------------------
create table store (
  id            smallint generated always as identity primary key,
  slug          text not null unique,
  name          text not null,
  base_url      text not null,
  adapter_id    text not null,
  is_active     boolean not null default true,
  freshness_sla interval not null default '48 hours',
  config        jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- category
-- -----------------------------------------------------------------------------
create table category (
  id        integer generated always as identity primary key,
  slug      text not null unique,
  name      text not null,
  parent_id integer references category(id),
  path      text not null,
  constraint path_unique unique (path)
);
create index idx_category_path_trgm on category using gin (path gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- product   (ean es char(13) desde el inicio: ver migracion 0009)
-- -----------------------------------------------------------------------------
create table product (
  id             bigint generated always as identity primary key,
  slug           text not null unique,
  canonical_name text not null,
  brand          text,
  ean            char(13) check (ean ~ '^\d{13}$'),
  unit_amount    numeric(10,3),
  unit_type      text check (unit_type in ('kg','g','l','ml','un')),
  image_url      text,
  image_hash     text,
  category_id    integer references category(id),
  search_vector  tsvector generated always as (
    to_tsvector('spanish', coalesce(canonical_name, '') || ' ' || coalesce(brand, ''))
  ) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_product_search on product using gin (search_vector);
create index idx_product_name_trgm on product using gin (canonical_name gin_trgm_ops);
create index idx_product_ean on product (ean) where ean is not null;
create index idx_product_category on product (category_id);
create index idx_product_image_hash on product (image_hash) where image_hash is not null;

-- -----------------------------------------------------------------------------
-- store_sku   (declared_ean char(13) desde el inicio)
-- -----------------------------------------------------------------------------
create table store_sku (
  id              bigint generated always as identity primary key,
  store_id        smallint not null references store(id),
  external_id     text not null,
  url             text not null,
  raw_description text not null,
  description     text,
  declared_ean    char(13) check (declared_ean ~ '^\d{13}$'),
  unit_label      text,
  last_seen_at    timestamptz,
  is_active       boolean not null default true,
  unique (store_id, external_id)
);
create index idx_storesku_ean on store_sku (declared_ean) where declared_ean is not null;

-- -----------------------------------------------------------------------------
-- match_link   (store_sku <-> product, 1:1)
-- -----------------------------------------------------------------------------
create table match_link (
  id           bigint generated always as identity primary key,
  store_sku_id bigint not null unique references store_sku(id),
  product_id   bigint not null references product(id),
  method       text not null check (method in ('ean','semantic','manual')),
  score        numeric(5,4),
  status       text not null default 'auto'
               check (status in ('auto','pending_review','confirmed','rejected')),
  decided_by   text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index idx_match_pending on match_link (status) where status = 'pending_review';

-- -----------------------------------------------------------------------------
-- price_record   (append-only, particionada por mes)
-- -----------------------------------------------------------------------------
create sequence price_record_id_seq;

create table price_record (
  id            bigint not null default nextval('price_record_id_seq'),
  store_sku_id  bigint not null references store_sku(id),
  price_amount  numeric(12,2) not null check (price_amount > 0),
  currency      citext not null default 'ARS',
  list_or_promo text not null default 'list' check (list_or_promo in ('list','promo')),
  unit_price    numeric(12,3),
  source_url    text not null,
  captured_at   timestamptz not null,
  run_id        uuid not null,
  is_suspect    boolean not null default false,
  primary key (id, captured_at)
) partition by range (captured_at);

create index idx_pr_sku_time on price_record (store_sku_id, captured_at desc);
create index idx_pr_brin on price_record using brin (captured_at);
create unique index idx_pr_dedupe on price_record (store_sku_id, captured_at, list_or_promo);

create or replace function ensure_price_record_partition(month_start date)
returns void as $$
declare
  partition_name text := 'price_record_' || to_char(month_start, 'YYYY_MM');
  next_month     date := month_start + interval '1 month';
begin
  execute format(
    'create table if not exists %I partition of price_record for values from (%L) to (%L)',
    partition_name, month_start, next_month
  );
end;
$$ language plpgsql;

do $$
declare
  current_month date := date_trunc('month', now())::date;
begin
  perform ensure_price_record_partition(current_month);
  perform ensure_price_record_partition((current_month + interval '1 month')::date);
end $$;

create or replace function price_record_immutable()
returns trigger as $$
begin
  raise exception 'price_record es append-only (Constitution V)';
end;
$$ language plpgsql;

create trigger price_record_no_mutation
  before update or delete on price_record
  for each row execute function price_record_immutable();

-- -----------------------------------------------------------------------------
-- price_correction
-- -----------------------------------------------------------------------------
create table price_correction (
  id             bigint generated always as identity primary key,
  original_run_id uuid not null,
  store_sku_id   bigint not null references store_sku(id),
  original_captured_at timestamptz not null,
  reason         text not null,
  corrected_by   text not null,
  created_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- price_aggregate
-- -----------------------------------------------------------------------------
create table price_aggregate (
  product_id       bigint primary key references product(id),
  best_store_id    smallint references store(id),
  best_price       numeric(12,2),
  best_captured_at timestamptz,
  min_30d          numeric(12,2),
  min_90d          numeric(12,2),
  min_all_time     numeric(12,2),
  avg_30d          numeric(12,2),
  pct_change_7d    numeric(6,2),
  pct_change_24h   numeric(6,2),
  stores_count     smallint,
  refreshed_at     timestamptz not null
);

-- -----------------------------------------------------------------------------
-- run_report
-- -----------------------------------------------------------------------------
create table run_report (
  run_id         uuid primary key,
  store_id       smallint not null references store(id),
  started_at     timestamptz not null,
  finished_at    timestamptz,
  status         text not null check (status in ('running','success','partial','failed')),
  skus_captured  integer not null default 0,
  skus_rejected  integer not null default 0,
  http_errors    integer not null default 0,
  quarantined    boolean not null default false,
  errors_sample  jsonb not null default '[]',
  correlation_id text not null
);
create index idx_run_report_store_time on run_report (store_id, started_at desc);

-- -----------------------------------------------------------------------------
-- deal_candidate / deal_publication
-- -----------------------------------------------------------------------------
create table deal_candidate (
  id             bigint generated always as identity primary key,
  product_id     bigint not null references product(id),
  detected_at    timestamptz not null default now(),
  detected_date  date generated always as ((detected_at at time zone 'America/Argentina/Buenos_Aires')::date) stored,
  discount_pct   numeric(6,2) not null,
  evidence       jsonb not null,
  status         text not null default 'pending'
                 check (status in ('pending','published','rejected')),
  rejected_until timestamptz
);
create unique index uq_deal_candidate_daily on deal_candidate (product_id, detected_date);

create table deal_publication (
  id           bigint generated always as identity primary key,
  candidate_id bigint not null unique references deal_candidate(id),
  published_by text not null,
  published_at timestamptz not null default now(),
  badge        text not null default 'Mejor Oportunidad de la Semana',
  expires_at   timestamptz
);

-- -----------------------------------------------------------------------------
-- admin_token
-- -----------------------------------------------------------------------------
create table admin_token (
  id         smallint generated always as identity primary key,
  label      text not null,
  token_hash text not null unique,
  role       text not null check (role in ('operator','admin')),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- user_savings   (migracion 0007)
-- -----------------------------------------------------------------------------
create table user_savings (
  device_id      text not null,
  savings_amount numeric not null default 0,
  item_count     integer not null default 0,
  updated_at     timestamptz not null default now(),
  constraint user_savings_pkey primary key (device_id)
);
create index user_savings_updated_at_index on user_savings (updated_at);

-- -----------------------------------------------------------------------------
-- daily_series   (materialized view; version final de la migracion 0004)
-- -----------------------------------------------------------------------------
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
create unique index ux_daily_series_product_day on daily_series (product_id, day);
create index idx_daily_series_product on daily_series (product_id, day desc);

-- -----------------------------------------------------------------------------
-- Vistas de analisis de orfandad (migracion 0010, read-only, opcionales)
-- -----------------------------------------------------------------------------
create or replace view v_orphan_store_sku as
select ss.id as sku_id, ss.store_id, s.slug as store_slug, ss.external_id,
       ss.declared_ean, ss.raw_description, ss.description, ss.url,
       ss.last_seen_at, ss.is_active,
       count(pr.id) as price_count,
       min(pr.captured_at) as first_price_date,
       max(pr.captured_at) as last_price_date
from store_sku ss
join store s on s.id = ss.store_id
left join price_record pr on pr.store_sku_id = ss.id
left join match_link ml on ml.store_sku_id = ss.id
where ml.id is null and ss.is_active = true
group by ss.id, ss.store_id, s.slug, ss.external_id, ss.declared_ean,
         ss.raw_description, ss.description, ss.url, ss.last_seen_at, ss.is_active
having count(pr.id) > 0;

create or replace view v_orphan_prices as
select pr.*, ss.store_id, s.slug as store_slug, ss.external_id,
       ss.declared_ean, ss.raw_description
from price_record pr
join store_sku ss on ss.id = pr.store_sku_id
join store s on s.id = ss.store_id
left join match_link ml on ml.store_sku_id = ss.id
where ml.id is null and ss.is_active = true;

create or replace view v_duplicate_store_sku as
select store_id, external_id, count(*) as dup_count,
       array_agg(id order by last_seen_at desc nulls last) as sku_ids
from store_sku
where is_active = true
group by store_id, external_id
having count(*) > 1;
