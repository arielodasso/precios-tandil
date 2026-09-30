'use strict';

export async function up(pgm) {
  // 0001 creó un CHECK anónimo (product_ean_check: ean >= 0) sobre la columna.
  // Postgres re-valida las expresiones dependientes al cambiar el tipo, y
  // `ean >= 0` queda como `character >= numeric` -> operator does not exist (42883).
  // chk_product_ean_format lo supersede por completo, asi que se elimina antes.
  await pgm.sql('alter table product drop constraint if exists product_ean_check;');
  await pgm.sql(
    "alter table product alter column ean type char(13) using lpad(ean::text, 13, '0');",
  );
  await pgm.sql(
    "alter table product add constraint chk_product_ean_format check (ean ~ '^\\d{13}$');",
  );
  await pgm.sql(
    "alter table store_sku alter column declared_ean type char(13) using lpad(declared_ean::text, 13, '0');",
  );
  await pgm.sql(
    "alter table store_sku add constraint chk_storesku_ean_format check (declared_ean ~ '^\\d{13}$');",
  );
  await pgm.sql('drop index if exists idx_product_ean;');
  await pgm.sql('create index idx_product_ean on product (ean) where ean is not null;');
  await pgm.sql('drop index if exists idx_storesku_ean;');
  await pgm.sql(
    'create index idx_storesku_ean on store_sku (declared_ean) where declared_ean is not null;',
  );
}

export async function down(pgm) {
  await pgm.sql('alter table product drop constraint if exists chk_product_ean_format;');
  await pgm.sql(
    "alter table product alter column ean type numeric(13) using nullif(ean, '')::numeric;",
  );
  await pgm.sql('alter table product add constraint product_ean_check check (ean >= 0);');
  await pgm.sql('alter table store_sku drop constraint if exists chk_storesku_ean_format;');
  await pgm.sql(
    "alter table store_sku alter column declared_ean type numeric(13) using nullif(declared_ean, '')::numeric;",
  );
  await pgm.sql('drop index if exists idx_product_ean;');
  await pgm.sql('create index idx_product_ean on product (ean) where ean is not null;');
  await pgm.sql('drop index if exists idx_storesku_ean;');
  await pgm.sql(
    'create index idx_storesku_ean on store_sku (declared_ean) where declared_ean is not null;',
  );
}
