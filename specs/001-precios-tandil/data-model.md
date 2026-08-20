# Data Model: Precios Tandil

**Date**: 2026-08-20 | **DB**: PostgreSQL 16+

Extensiones requeridas: `pg_trgm`, `unaccent`, `citext`, `pgcrypto`.

## Diagrama lógico (resumen)

```text
store 1─* store_sku 1─* price_record
              │ 0..1
              └*─1 match_link *─1 product *─1 category
product 1─1 price_aggregate
store 1─* run_report
deal_candidate *─1 product ; deal_publication 1─1 deal_candidate
```

## Tablas

### `store`

```sql
CREATE TABLE store (
  id            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          text NOT NULL UNIQUE,            -- 'carrefour', 'dia', ...
  name          text NOT NULL,
  base_url      text NOT NULL,
  adapter_id    text NOT NULL,                   -- package del adaptador
  is_active     boolean NOT NULL DEFAULT true,
  freshness_sla interval NOT NULL DEFAULT '48 hours',
  config        jsonb NOT NULL DEFAULT '{}',     -- concurrencia, proxy pool id, delays
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### `category`

```sql
CREATE TABLE category (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  parent_id  integer REFERENCES category(id),
  path       text NOT NULL,          -- 'almacen/arroz' materializado
  CONSTRAINT path_unique UNIQUE (path)
);
CREATE INDEX idx_category_path_trgm ON category USING gin (path gin_trgm_ops);
```

### `product` (producto unificado)

```sql
CREATE TABLE product (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug           text NOT NULL UNIQUE,           -- 'arroz-gallo-oro-1kg'
  canonical_name text NOT NULL,                  -- nombre normalizado
  brand          text,
  ean            bigint CHECK (ean >= 0),        -- primario si existe
  unit_amount    numeric(10,3),                  -- 1.000
  unit_type      text CHECK (unit_type IN ('kg','g','l','ml','un','m')),
  image_url      text,
  category_id    integer REFERENCES category(id),
  search_vector  tsvector,                       -- generado por trigger
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_search ON product USING gin (search_vector);
CREATE INDEX idx_product_name_trgm ON product USING gin (canonical_name gin_trgm_ops);
CREATE INDEX idx_product_ean ON product (ean) WHERE ean IS NOT NULL;
CREATE INDEX idx_product_category ON product (category_id);
```

### `store_sku` (SKU tal como publica cada tienda)

```sql
CREATE TABLE store_sku (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id        smallint NOT NULL REFERENCES store(id),
  external_id     text NOT NULL,                 -- id interno de la tienda
  url             text NOT NULL,
  raw_description text NOT NULL,                 -- descripción original
  declared_ean    bigint,
  unit_label      text,                          -- 'x 1 kg', '500 ml'
  last_seen_at    timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  UNIQUE (store_id, external_id)
);
CREATE INDEX idx_storesku_ean ON store_sku (declared_ean) WHERE declared_ean IS NOT NULL;
```

### `match_link` (StoreSku ↔ Product)

```sql
CREATE TABLE match_link (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_sku_id  bigint NOT NULL UNIQUE REFERENCES store_sku(id),
  product_id    bigint NOT NULL REFERENCES product(id),
  method        text NOT NULL CHECK (method IN ('ean','semantic','manual')),
  score         numeric(5,4),
  status        text NOT NULL DEFAULT 'auto'
                CHECK (status IN ('auto','pending_review','confirmed','rejected')),
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_conflict UNIQUE (store_sku_id)
);
CREATE INDEX idx_match_pending ON match_link (status) WHERE status = 'pending_review';
```

Regla EAN conflictiva (edge case spec): si dos `raw_description` muy dispares
comparten `declared_ean`, se separan grupos y ambos matches van a
`pending_review`.

### `price_record` (append-only, particionada)

```sql
CREATE TABLE price_record (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  store_sku_id  bigint NOT NULL REFERENCES store_sku(id),
  price_amount  numeric(12,2) NOT NULL CHECK (price_amount > 0),
  currency      citext NOT NULL DEFAULT 'ARS',
  list_or_promo text NOT NULL DEFAULT 'list' CHECK (list_or_promo IN ('list','promo')),
  unit_price    numeric(12,3),                   -- precio por unidad canónica
  source_url    text NOT NULL,
  captured_at   timestamptz NOT NULL,
  run_id        uuid NOT NULL,
  is_suspect    boolean NOT NULL DEFAULT false,  -- variación > 80 % sin confirmar
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

-- Particiones mensuales creadas por job (ejemplo):
CREATE TABLE price_record_2026_08 PARTITION OF price_record
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX idx_pr_sku_time ON price_record (store_sku_id, captured_at DESC);
CREATE INDEX idx_pr_brin ON price_record USING brin (captured_at);
CREATE UNIQUE INDEX idx_pr_dedupe ON price_record (store_sku_id, captured_at, list_or_promo);
```

Inmutabilidad (Constitución V):

```sql
CREATE RULE price_record_no_update AS ON UPDATE TO price_record DO INSTEAD NOTHING;
CREATE RULE price_record_no_delete AS ON DELETE TO price_record DO INSTEAD NOTHING;
```

Correcciones: tabla `price_correction` (price_record original, motivo,
operador, timestamp) — nunca UPDATE sobre la serie.

### `price_aggregate` (precalculado por producto)

```sql
CREATE TABLE price_aggregate (
  product_id        bigint PRIMARY KEY REFERENCES product(id),
  best_store_id     smallint REFERENCES store(id),
  best_price        numeric(12,2),
  best_captured_at  timestamptz,
  min_30d           numeric(12,2),
  min_90d           numeric(12,2),
  min_all_time      numeric(12,2),
  avg_30d           numeric(12,2),
  pct_change_7d     numeric(6,2),               -- % vs hace 7 días
  pct_change_24h    numeric(6,2),
  stores_count      smallint,
  refreshed_at      timestamptz NOT NULL
);
```

### `run_report` (observabilidad de ingesta)

```sql
CREATE TABLE run_report (
  run_id          uuid PRIMARY KEY,
  store_id        smallint NOT NULL REFERENCES store(id),
  started_at      timestamptz NOT NULL,
  finished_at     timestamptz,
  status          text NOT NULL CHECK (status IN ('running','success','partial','failed')),
  skus_captured   integer NOT NULL DEFAULT 0,
  skus_rejected   integer NOT NULL DEFAULT 0,
  http_errors     integer NOT NULL DEFAULT 0,
  quarantined     boolean NOT NULL DEFAULT false,
  errors_sample   jsonb NOT NULL DEFAULT '[]',   -- hasta 20 errores representativos
  correlation_id  text NOT NULL
);
```

### `deal_candidate` / `deal_publication`

```sql
CREATE TABLE deal_candidate (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id      bigint NOT NULL REFERENCES product(id),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  discount_pct    numeric(6,2) NOT NULL,
  evidence        jsonb NOT NULL,   -- precio actual, promedio 30d, tienda, fuente
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','published','rejected')),
  rejected_until  timestamptz,      -- rechazada no se reproponen por 14 días
  UNIQUE (product_id, detected_at::date)
);

CREATE TABLE deal_publication (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id    bigint NOT NULL UNIQUE REFERENCES deal_candidate(id),
  published_by    text NOT NULL,
  published_at    timestamptz NOT NULL DEFAULT now(),
  badge           text NOT NULL DEFAULT 'Mejor Oportunidad de la Semana',
  expires_at      timestamptz
);
```

### `admin_token`

```sql
CREATE TABLE admin_token (
  id           smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label        text NOT NULL,
  token_hash   text NOT NULL UNIQUE,   -- sha256 del bearer
  role         text NOT NULL CHECK (role IN ('operator','admin')),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

## Reglas de cálculo clave

- **Variación % diaria/semanal**: `(p_actual − p_previo)/p_previo × 100` usando
  el último precio válido (no suspect) previo a la ventana.
- **Menor precio histórico**: `MIN(price_amount)` excluyendo `is_suspect`,
  ventanas 30/90 días y all-time, por producto unificado (no por SKU).
- **Frescura**: `now() − MAX(captured_at)` por tienda; > 72 h dispara alerta
  (Constitución VIII); > 7 días excluye la tienda del ranking "mejor precio".
- **Oportunidad**: descuento ≥ 15 % vs `avg_30d` y ≥ 2 tiendas con datos frescos.
