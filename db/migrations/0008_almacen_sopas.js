'use strict';

/**
 * Agrega subcategorías de Almacén faltantes para productos que quedaban
 * en el bucket default 'almacen' (sopas, caldos, ramen y preparados).
 *
 * Idempotente: ON CONFLICT (slug) DO NOTHING.
 */

const SUBCATEGORIES = [{ slug: 'sopas', name: 'Caldos y Sopas', parent: 'almacen' }];

exports.up = (pgm) => {
  for (const cat of SUBCATEGORIES) {
    pgm.sql(`
      INSERT INTO category (slug, name, parent_id, path)
      SELECT '${cat.slug}', '${cat.name}', p.id, '${cat.parent}/${cat.slug}'
      FROM (SELECT id FROM category WHERE slug = '${cat.parent}') p
      ON CONFLICT (slug) DO NOTHING
    `);
  }
};

exports.down = (pgm) => {
  for (const cat of SUBCATEGORIES) {
    pgm.sql(`DELETE FROM category WHERE slug = '${cat.slug}'`);
  }
};
