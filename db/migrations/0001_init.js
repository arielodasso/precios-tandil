'use strict';

const TABLES = [
  'deal_publication',
  'deal_candidate',
  'price_correction',
  'run_report',
  'price_aggregate',
  'match_link',
  'store_sku',
  'product',
  'category',
  'store',
  'admin_token',
];

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS unaccent;
    CREATE EXTENSION IF NOT EXISTS citext;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE store (
      id            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      slug          text NOT NULL UNIQUE,
      name          text NOT NULL,
      base_url      text NOT NULL,
      adapter_id    text NOT NULL,
      is_active     boolean NOT NULL DEFAULT true,
      freshness_sla interval NOT NULL DEFAULT '48 hours',
      config        jsonb NOT NULL DEFAULT '{}',
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE category (
      id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      slug      text NOT NULL UNIQUE,
      name      text NOT NULL,
      parent_id integer REFERENCES category(id),
      path      text NOT NULL,
      CONSTRAINT path_unique UNIQUE (path)
    );
    CREATE INDEX idx_category_path_trgm ON category USING gin (path gin_trgm_ops);

    CREATE TABLE product (
      id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      slug           text NOT NULL UNIQUE,
      canonical_name text NOT NULL,
      brand          text,
      ean            numeric(13) CHECK (ean >= 0),
      unit_amount    numeric(10,3),
      unit_type      text CHECK (unit_type IN ('kg','g','l','ml','un')),
      image_url      text,
      category_id    integer REFERENCES category(id),
      search_vector  tsvector GENERATED ALWAYS AS (
        to_tsvector('spanish', coalesce(canonical_name, '') || ' ' || coalesce(brand, ''))
      ) STORED,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_product_search ON product USING gin (search_vector);
    CREATE INDEX idx_product_name_trgm ON product USING gin (canonical_name gin_trgm_ops);
    CREATE INDEX idx_product_ean ON product (ean) WHERE ean IS NOT NULL;
    CREATE INDEX idx_product_category ON product (category_id);

    CREATE TABLE store_sku (
      id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      store_id        smallint NOT NULL REFERENCES store(id),
      external_id     text NOT NULL,
      url             text NOT NULL,
      raw_description text NOT NULL,
      declared_ean    numeric(13),
      unit_label      text,
      last_seen_at    timestamptz,
      is_active       boolean NOT NULL DEFAULT true,
      UNIQUE (store_id, external_id)
    );
    CREATE INDEX idx_storesku_ean ON store_sku (declared_ean) WHERE declared_ean IS NOT NULL;

    CREATE TABLE match_link (
      id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      store_sku_id bigint NOT NULL UNIQUE REFERENCES store_sku(id),
      product_id   bigint NOT NULL REFERENCES product(id),
      method       text NOT NULL CHECK (method IN ('ean','semantic','manual')),
      score        numeric(5,4),
      status       text NOT NULL DEFAULT 'auto'
                   CHECK (status IN ('auto','pending_review','confirmed','rejected')),
      decided_by   text,
      decided_at   timestamptz,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_match_pending ON match_link (status) WHERE status = 'pending_review';

    CREATE SEQUENCE price_record_id_seq;

    CREATE TABLE price_record (
      id            bigint NOT NULL DEFAULT nextval('price_record_id_seq'),
      store_sku_id  bigint NOT NULL REFERENCES store_sku(id),
      price_amount  numeric(12,2) NOT NULL CHECK (price_amount > 0),
      currency      citext NOT NULL DEFAULT 'ARS',
      list_or_promo text NOT NULL DEFAULT 'list' CHECK (list_or_promo IN ('list','promo')),
      unit_price    numeric(12,3),
      source_url    text NOT NULL,
      captured_at   timestamptz NOT NULL,
      run_id        uuid NOT NULL,
      is_suspect    boolean NOT NULL DEFAULT false,
      PRIMARY KEY (id, captured_at)
    ) PARTITION BY RANGE (captured_at);

    CREATE INDEX idx_pr_sku_time ON price_record (store_sku_id, captured_at DESC);
    CREATE INDEX idx_pr_brin ON price_record USING brin (captured_at);
    CREATE UNIQUE INDEX idx_pr_dedupe ON price_record (store_sku_id, captured_at, list_or_promo);

    CREATE OR REPLACE FUNCTION ensure_price_record_partition(month_start date)
    RETURNS void AS $$
    DECLARE
      partition_name text := 'price_record_' || to_char(month_start, 'YYYY_MM');
      next_month     date := month_start + interval '1 month';
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF price_record FOR VALUES FROM (%L) TO (%L)',
        partition_name, month_start, next_month
      );
    END;
    $$ LANGUAGE plpgsql;

    DO $$
    DECLARE
      current_month date := date_trunc('month', now())::date;
    BEGIN
      PERFORM ensure_price_record_partition(current_month);
      PERFORM ensure_price_record_partition(current_month + interval '1 month');
    END $$;

    CREATE OR REPLACE FUNCTION price_record_immutable()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'price_record es append-only (Constitution V)';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER price_record_no_mutation
      BEFORE UPDATE OR DELETE ON price_record
      FOR EACH ROW EXECUTE FUNCTION price_record_immutable();

    CREATE TABLE price_correction (
      id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      original_run_id uuid NOT NULL,
      store_sku_id   bigint NOT NULL REFERENCES store_sku(id),
      original_captured_at timestamptz NOT NULL,
      reason         text NOT NULL,
      corrected_by   text NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE price_aggregate (
      product_id       bigint PRIMARY KEY REFERENCES product(id),
      best_store_id    smallint REFERENCES store(id),
      best_price       numeric(12,2),
      best_captured_at timestamptz,
      min_30d          numeric(12,2),
      min_90d          numeric(12,2),
      min_all_time     numeric(12,2),
      avg_30d          numeric(12,2),
      pct_change_7d    numeric(6,2),
      pct_change_24h   numeric(6,2),
      stores_count     smallint,
      refreshed_at     timestamptz NOT NULL
    );

    CREATE TABLE run_report (
      run_id         uuid PRIMARY KEY,
      store_id       smallint NOT NULL REFERENCES store(id),
      started_at     timestamptz NOT NULL,
      finished_at    timestamptz,
      status         text NOT NULL CHECK (status IN ('running','success','partial','failed')),
      skus_captured  integer NOT NULL DEFAULT 0,
      skus_rejected  integer NOT NULL DEFAULT 0,
      http_errors    integer NOT NULL DEFAULT 0,
      quarantined    boolean NOT NULL DEFAULT false,
      errors_sample  jsonb NOT NULL DEFAULT '[]',
      correlation_id text NOT NULL
    );
    CREATE INDEX idx_run_report_store_time ON run_report (store_id, started_at DESC);

    CREATE TABLE deal_candidate (
      id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      product_id     bigint NOT NULL REFERENCES product(id),
      detected_at    timestamptz NOT NULL DEFAULT now(),
      discount_pct   numeric(6,2) NOT NULL,
      evidence       jsonb NOT NULL,
      status         text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','published','rejected')),
      rejected_until timestamptz
    );
    CREATE UNIQUE INDEX uq_deal_candidate_daily
      ON deal_candidate (product_id, (detected_at::date));

    CREATE TABLE deal_publication (
      id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      candidate_id bigint NOT NULL UNIQUE REFERENCES deal_candidate(id),
      published_by text NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now(),
      badge        text NOT NULL DEFAULT 'Mejor Oportunidad de la Semana',
      expires_at   timestamptz
    );

    CREATE TABLE admin_token (
      id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      label      text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      role       text NOT NULL CHECK (role IN ('operator','admin')),
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS ensure_price_record_partition(date);
    DROP FUNCTION IF EXISTS price_record_immutable();
    ${[...TABLES]
      .reverse()
      .map((t) => `DROP TABLE IF EXISTS ${t} CASCADE;`)
      .join('\n')}
    DROP TABLE IF EXISTS price_record CASCADE;
    DROP SEQUENCE IF EXISTS price_record_id_seq;
  `);
};
