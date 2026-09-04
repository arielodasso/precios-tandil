'use strict';

/**
 * Expande la taxonomía de categorías para cubrir todos los tipos de productos
 * de supermercado. Antes solo había 13 categorías; ahora ~40 que cubren
 * despensa completa, lácteos, fiambres, panadería, bebidas alcohólicas,
 * etc.
 *
 * Se usa ON CONFLICT (slug) DO NOTHING para que sea idempotente.
 */

const CATEGORIES = [
  // ── Almacén ──────────────────────────────────────────────
  { slug: 'arroz', name: 'Arroz', parent: 'almacen' },
  { slug: 'aceite', name: 'Aceite', parent: 'almacen' },
  { slug: 'yerba', name: 'Yerba', parent: 'almacen' },
  { slug: 'azucar', name: 'Azúcar', parent: 'almacen' },
  { slug: 'fideos', name: 'Fideos y Pastas', parent: 'almacen' },
  { slug: 'harinas', name: 'Harinas', parent: 'almacen' },
  { slug: 'cafe', name: 'Café', parent: 'almacen' },
  { slug: 'galletitas', name: 'Galletitas', parent: 'almacen' },
  { slug: 'snacks', name: 'Snacks', parent: 'almacen' },
  { slug: 'condimentos', name: 'Condimentos y Especias', parent: 'almacen' },
  { slug: 'salsas', name: 'Salsas y Aderezos', parent: 'almacen' },
  { slug: 'conservas', name: 'Conservas', parent: 'almacen' },
  { slug: 'infusiones', name: 'Infusiones', parent: 'almacen' },
  { slug: 'chocolates', name: 'Chocolates y Dulces', parent: 'almacen' },
  { slug: 'cereales', name: 'Cereales y Frutas Secas', parent: 'almacen' },
  { slug: 'reposteria', name: 'Repostería', parent: 'almacen' },
  { slug: 'prepizzas', name: 'Prepizzas y Congelados de Almacén', parent: 'almacen' },

  // ── Bebidas ──────────────────────────────────────────────
  { slug: 'gaseosas', name: 'Gaseosas', parent: 'bebidas' },
  { slug: 'aguas', name: 'Agua', parent: 'bebidas' },
  { slug: 'jugos', name: 'Jugos y Extractos', parent: 'bebidas' },
  { slug: 'cervezas', name: 'Cervezas', parent: 'bebidas' },
  { slug: 'vinos', name: 'Vinos', parent: 'bebidas' },
  { slug: 'bebidas-alcoholicas', name: 'Bebidas Alcohólicas', parent: 'bebidas' },
  { slug: 'isotonicas', name: 'Isotónicas y Energizantes', parent: 'bebidas' },

  // ── Lácteos ──────────────────────────────────────────────
  { slug: 'leches', name: 'Leches', parent: 'lacteos' },
  { slug: 'yogures', name: 'Yogures', parent: 'lacteos' },
  { slug: 'quesos', name: 'Quesos', parent: 'lacteos' },
  { slug: 'manteca', name: 'Manteca y Margarina', parent: 'lacteos' },
  { slug: 'dulce-de-leche', name: 'Dulce de Leche', parent: 'lacteos' },
  { slug: 'postres-frescos', name: 'Postres Frescos', parent: 'lacteos' },

  // ── Frescos ──────────────────────────────────────────────
  { slug: 'carnes', name: 'Carnes', parent: 'frescos' },
  { slug: 'fiambres', name: 'Fiambres y Embutidos', parent: 'frescos' },
  { slug: 'panaderia', name: 'Panadería', parent: 'frescos' },
  { slug: 'pastas-frescas', name: 'Pastas Frescas', parent: 'frescos' },
  { slug: 'frutas-y-verduras', name: 'Frutas y Verduras', parent: 'frescos' },
  { slug: 'huevos', name: 'Huevos', parent: 'frescos' },
  { slug: 'rotiseria', name: 'Rotisería', parent: 'frescos' },
  { slug: 'pescados', name: 'Pescados y Mariscos', parent: 'frescos' },

  // ── Congelados ───────────────────────────────────────────
  { slug: 'helados', name: 'Helados', parent: 'congelados' },
  { slug: 'congelados-preparados', name: 'Congelados Preparados', parent: 'congelados' },
  { slug: 'verduras-congeladas', name: 'Verduras Congeladas', parent: 'congelados' },

  // ── Limpieza ─────────────────────────────────────────────
  { slug: 'detergentes', name: 'Detergentes', parent: 'limpieza' },
  { slug: 'lavandinas', name: 'Lavandinas', parent: 'limpieza' },
  { slug: 'higiene-del-hogar', name: 'Higiene del Hogar', parent: 'limpieza' },
  { slug: 'bolsas', name: 'Bolsas y Residuos', parent: 'limpieza' },

  // ── Perfumería ───────────────────────────────────────────
  { slug: 'cuidado-cabello', name: 'Cuidado del Cabello', parent: 'perfumeria' },
  { slug: 'cuidado-corporal', name: 'Cuidado Corporal', parent: 'perfumeria' },
  { slug: 'higiene-bucal', name: 'Higiene Bucal', parent: 'perfumeria' },
  { slug: 'desodorantes', name: 'Desodorantes', parent: 'perfumeria' },
  { slug: 'pañales', name: 'Pañales y Bebés', parent: 'perfumeria' },

  // ── Mascotas ─────────────────────────────────────────────
  { slug: 'mascotas', name: 'Mascotas', parent: null },
];

exports.up = (pgm) => {
  for (const cat of CATEGORIES) {
    const path = cat.parent ? `${cat.parent}/${cat.slug}` : cat.slug;
    const slug = "'" + cat.slug.replace(/'/g, "''") + "'";
    const name = "'" + cat.name.replace(/'/g, "''") + "'";
    const pathLit = "'" + path.replace(/'/g, "''") + "'";
    const parent = cat.parent ? "'" + cat.parent.replace(/'/g, "''") + "'" : 'NULL';
    pgm.sql(`
      INSERT INTO category (slug, name, parent_id, path)
      SELECT ${slug}, ${name}, p.id, ${pathLit}
      FROM (SELECT id FROM category WHERE slug = ${parent}) p
      ON CONFLICT (slug) DO NOTHING
    `);
  }
};

exports.down = (pgm) => {
  for (const cat of CATEGORIES) {
    pgm.sql(`DELETE FROM category WHERE slug = '${cat.slug.replace(/'/g, "''")}'`);
  }
};
