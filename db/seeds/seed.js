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
];

const CATEGORIES = [
  { slug: 'almacen', name: 'Almacén', parent: null },
  { slug: 'arroz', name: 'Arroz', parent: 'almacen' },
  { slug: 'aceite', name: 'Aceite', parent: 'almacen' },
  { slug: 'yerba', name: 'Yerba', parent: 'almacen' },
  { slug: 'azucar', name: 'Azúcar', parent: 'almacen' },
  { slug: 'bebidas', name: 'Bebidas', parent: null },
  { slug: 'gaseosas', name: 'Gaseosas', parent: 'bebidas' },
  { slug: 'lacteos', name: 'Lácteos', parent: null },
  { slug: 'frescos', name: 'Frescos', parent: null },
  { slug: 'carnes', name: 'Carnes', parent: 'frescos' },
  { slug: 'limpieza', name: 'Limpieza', parent: null },
  { slug: 'perfumeria', name: 'Perfumería', parent: null },
  { slug: 'congelados', name: 'Congelados', parent: null },
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
