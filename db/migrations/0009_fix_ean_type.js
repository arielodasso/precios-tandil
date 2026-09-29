'use strict';

export async function up(pgm) {
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
