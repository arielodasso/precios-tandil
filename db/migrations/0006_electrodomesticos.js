'use strict';

/**
 * Agrega la categoría raíz "Electrodomésticos y Tecnología".
 *
 * Hay productos electrodomésticos y de electrónica (heladeras, licuadoras,
 * microondas, cafeteras, airfryers, smart TVs, tablets, ventiladores, etc.)
 * que llegan de los adapters y hoy caen en 'almacen' (default) o en
 * 'almacen/infusiones' (catch-all). Esta categoría les da un hogar propio.
 *
 * Idempotente: ON CONFLICT (slug) DO NOTHING.
 */

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO category (slug, name, parent_id, path)
    SELECT 'electrodomesticos', 'Electrodomésticos y Tecnología', NULL, 'electrodomesticos'
    WHERE NOT EXISTS (SELECT 1 FROM category WHERE slug = 'electrodomesticos')
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM category WHERE slug = 'electrodomesticos'`);
};
