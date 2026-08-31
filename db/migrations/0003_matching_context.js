/**
 * T059 — Soporte para matching con contexto:
 *  - product.image_hash: hash perceptual (dHash 64-bit hex) de la imagen
 *    principal, para confirmar/descartar candidatos por imagen.
 *  - store_sku.description: texto extendido de la fuente (descripción) usado
 *    como contexto de tipos para el normalizador/matcher.
 */
export async function up(pgm) {
  await pgm.sql(`
    alter table product add column image_hash text;
    create index idx_product_image_hash on product (image_hash) where image_hash is not null;
  `);

  await pgm.sql(`
    alter table store_sku add column description text;
  `);
}

export async function down(pgm) {
  await pgm.sql(`alter table product drop column if exists image_hash;`);
  await pgm.sql(`alter table store_sku drop column if exists description;`);
}
