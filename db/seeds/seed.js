'use strict';

const crypto = require('node:crypto');
const { Client } = require('pg');

const STORES = [
  ['carrefour', 'Carrefour', 'https://www.carrefour.com.ar/'],
  ['monarca', 'Monarca', 'https://web.monarcadigital.com.ar/'],
  ['comerciante-maxi', 'Carrefour Maxi (Comerciante)', 'https://comerciante.carrefour.com.ar/'],
  ['dia', 'DIA', 'https://diaonline.supermercadosdia.com.ar/'],
  ['cooperativa-obrera', 'Cooperativa Obrera', 'https://www.cooperativaobrera.coop/'],
  ['vea', 'Vea', 'https://www.vea.com.ar/'],
  ['golopolis', 'Golopolis', 'https://www.golopolis.com.ar/'],
];

const CATEGORIES = [
  // ── Root categories ──
  { slug: 'almacen', name: 'Almacén', parent: null },
  { slug: 'bebidas', name: 'Bebidas', parent: null },
  { slug: 'lacteos', name: 'Lácteos', parent: null },
  { slug: 'frescos', name: 'Frescos', parent: null },
  { slug: 'limpieza', name: 'Limpieza', parent: null },
  { slug: 'perfumeria', name: 'Perfumería', parent: null },
  { slug: 'congelados', name: 'Congelados', parent: null },
  { slug: 'mascotas', name: 'Mascotas', parent: null },
  { slug: 'electrodomesticos', name: 'Electrodomésticos y Tecnología', parent: null },
  // ── Almacén children ──
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
  // ── Bebidas children ──
  { slug: 'gaseosas', name: 'Gaseosas', parent: 'bebidas' },
  { slug: 'aguas', name: 'Agua', parent: 'bebidas' },
  { slug: 'jugos', name: 'Jugos y Extractos', parent: 'bebidas' },
  { slug: 'cervezas', name: 'Cervezas', parent: 'bebidas' },
  { slug: 'vinos', name: 'Vinos', parent: 'bebidas' },
  { slug: 'bebidas-alcoholicas', name: 'Bebidas Alcohólicas', parent: 'bebidas' },
  // ── Lácteos children ──
  { slug: 'leches', name: 'Leches', parent: 'lacteos' },
  { slug: 'yogures', name: 'Yogures', parent: 'lacteos' },
  { slug: 'quesos', name: 'Quesos', parent: 'lacteos' },
  { slug: 'manteca', name: 'Manteca y Margarina', parent: 'lacteos' },
  { slug: 'dulce-de-leche', name: 'Dulce de Leche', parent: 'lacteos' },
  { slug: 'postres-frescos', name: 'Postres Frescos', parent: 'lacteos' },
  // ── Frescos children ──
  { slug: 'carnes', name: 'Carnes', parent: 'frescos' },
  { slug: 'fiambres', name: 'Fiambres y Embutidos', parent: 'frescos' },
  { slug: 'panaderia', name: 'Panadería', parent: 'frescos' },
  { slug: 'pastas-frescas', name: 'Pastas Frescas', parent: 'frescos' },
  { slug: 'frutas-y-verduras', name: 'Frutas y Verduras', parent: 'frescos' },
  { slug: 'huevos', name: 'Huevos', parent: 'frescos' },
  { slug: 'rotiseria', name: 'Rotisería', parent: 'frescos' },
  { slug: 'pescados', name: 'Pescados y Mariscos', parent: 'frescos' },
  // ── Congelados children ──
  { slug: 'helados', name: 'Helados', parent: 'congelados' },
  { slug: 'congelados-preparados', name: 'Congelados Preparados', parent: 'congelados' },
  { slug: 'verduras-congeladas', name: 'Verduras Congeladas', parent: 'congelados' },
  // ── Limpieza children ──
  { slug: 'detergentes', name: 'Detergentes', parent: 'limpieza' },
  { slug: 'lavandinas', name: 'Lavandinas', parent: 'limpieza' },
  { slug: 'higiene-del-hogar', name: 'Higiene del Hogar', parent: 'limpieza' },
  { slug: 'bolsas', name: 'Bolsas y Residuos', parent: 'limpieza' },
  // ── Perfumería children ──
  { slug: 'cuidado-cabello', name: 'Cuidado del Cabello', parent: 'perfumeria' },
  { slug: 'cuidado-corporal', name: 'Cuidado Corporal', parent: 'perfumeria' },
  { slug: 'higiene-bucal', name: 'Higiene Bucal', parent: 'perfumeria' },
  { slug: 'desodorantes', name: 'Desodorantes', parent: 'perfumeria' },
  { slug: 'pañales', name: 'Pañales y Bebés', parent: 'perfumeria' },
];

async function main() {
  const connectionString =
    process.env.DATABASE_URL || 'postgres://precios:precios@localhost:5432/precios';
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const [slug, name, baseUrl] of STORES) {
      await client.query(
        `INSERT INTO store (slug, name, base_url, adapter_id)
         VALUES ($1, $2, $3, $1)
         ON CONFLICT (slug) DO NOTHING`,
        [slug, name, baseUrl],
      );
    }

    const idsBySlug = new Map();
    for (const cat of CATEGORIES) {
      const path = cat.parent ? `${cat.parent}/${cat.slug}` : cat.slug;
      const parentId = cat.parent ? idsBySlug.get(cat.parent) : null;
      const res = await client.query(
        `INSERT INTO category (slug, name, parent_id, path)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [cat.slug, cat.name, parentId, path],
      );
      if (res.rows[0]) {
        idsBySlug.set(cat.slug, res.rows[0].id);
      } else {
        const existing = await client.query('SELECT id FROM category WHERE slug = $1', [cat.slug]);
        idsBySlug.set(cat.slug, existing.rows[0].id);
      }
    }

    const devToken = process.env.ADMIN_TOKEN_DEV || 'dev-token';
    const tokenHash = crypto.createHash('sha256').update(devToken).digest('hex');
    await client.query(
      `INSERT INTO admin_token (label, token_hash, role)
       VALUES ('dev-bootstrap', $1, 'admin')
       ON CONFLICT (token_hash) DO NOTHING`,
      [tokenHash],
    );

    console.log('Seed completado: tiendas, categorías y token admin dev.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
