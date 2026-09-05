import { sql } from 'kysely';
import type { KyselyDB } from '@/lib/queries/analytics';

/**
 * Canasta fija inspirada en la Canasta Básica Alimentaria (INDEC),
 * adaptada a los productos que realmente se venden en el catálogo.
 *
 * Cada rubro define UN producto representativo utilizando un patrón sobre
 * canonical_name. El representante se elige con mayor cobertura de tiendas y,
 * a igual cobertura, el más barato. Así la comparación entre supermercados se
 * hace siempre sobre el MISMO conjunto de productos.
 */

export interface CbaItem {
  key: string;
  label: string;
  rubric: string;
  match: RegExp;
}

export const CBA_ITEMS: CbaItem[] = [
  { key: 'cereales-pan', label: 'Pan lactal', rubric: 'Cereales', match: /^pan lactal/ },
  {
    key: 'cereales-galletitas-agua',
    label: 'Galletitas de agua',
    rubric: 'Cereales',
    match: /^galletitas agua/,
  },
  {
    key: 'cereales-galletitas-dulces',
    label: 'Galletitas dulces',
    rubric: 'Cereales',
    match: /^galletas? dulces?/,
  },
  {
    key: 'cereales-arroz',
    label: 'Arroz',
    rubric: 'Cereales',
    match: /^arroz (molinos ala|parboil|largo fino)/,
  },
  {
    key: 'cereales-harina',
    label: 'Harina de trigo',
    rubric: 'Cereales',
    match: /^harina (trigo|0000)/,
  },
  { key: 'cereales-fideos', label: 'Fideos', rubric: 'Cereales', match: /^fideos / },

  { key: 'carnes-asado', label: 'Asado', rubric: 'Carnes y huevos', match: /^asado$/ },
  { key: 'carnes-atun', label: 'Atún', rubric: 'Carnes y huevos', match: /^atun / },
  { key: 'carnes-huevos', label: 'Huevos', rubric: 'Carnes y huevos', match: /^huevos blancos/ },

  { key: 'lacteos-queso', label: 'Queso', rubric: 'Lácteos', match: /^queso / },
  { key: 'lacteos-yogur', label: 'Yogur', rubric: 'Lácteos', match: /^yogur / },
  { key: 'lacteos-manteca', label: 'Manteca', rubric: 'Lácteos', match: /^manteca( tonadita)?$/ },

  {
    key: 'verduras-tomate',
    label: 'Tomate envasado',
    rubric: 'Verduras y legumbres',
    match: /^tomate perita/,
  },
  {
    key: 'verduras-cebolla',
    label: 'Cebolla deshidratada',
    rubric: 'Verduras y legumbres',
    match: /^cebolla deshidratada/,
  },
  {
    key: 'verduras-lentejas',
    label: 'Lentejas',
    rubric: 'Verduras y legumbres',
    match: /^lentejas /,
  },
  { key: 'verduras-arvejas', label: 'Arvejas', rubric: 'Verduras y legumbres', match: /^arvejas / },

  {
    key: 'azucares-azucar',
    label: 'Azúcar',
    rubric: 'Azúcares y dulces',
    match: /^azucar (tradicional|premium|domino|superior)/,
  },
  {
    key: 'azucares-dulce-leche',
    label: 'Dulce de leche',
    rubric: 'Azúcares y dulces',
    match: /^dulce leche /,
  },
  {
    key: 'azucares-mermelada',
    label: 'Mermelada',
    rubric: 'Azúcares y dulces',
    match: /^mermelada /,
  },
  {
    key: 'azucares-dulce-batata',
    label: 'Dulce de batata',
    rubric: 'Azúcares y dulces',
    match: /^dulce batata arcor$/,
  },

  { key: 'otros-aceite', label: 'Aceite de girasol', rubric: 'Otros', match: /^aceite girasol / },
  { key: 'otros-sal', label: 'Sal fina', rubric: 'Otros', match: /^sal fina / },
  { key: 'otros-agua', label: 'Agua mineral', rubric: 'Otros', match: /^agua mineral / },
];

export interface CbaResolvedProduct {
  key: string;
  label: string;
  rubric: string;
  productId: number;
  slug: string;
  canonicalName: string;
  brand: string | null;
}

interface CandidateRow {
  product_id: number;
  slug: string;
  canonical_name: string;
  brand: string | null;
  best_price: number;
  stores_count: number;
}

async function fetchCandidates(db: KyselyDB): Promise<CandidateRow[]> {
  const rows = await sql<CandidateRow>`
    select p.id::int as product_id,
           p.slug,
           p.canonical_name,
           p.brand,
           pa.best_price::float8 as best_price,
           pa.stores_count
    from product p
    join price_aggregate pa on pa.product_id = p.id
    where pa.stores_count >= 2
      and pa.best_price::numeric >= 500
  `.execute(db);
  return rows.rows;
}

/**
 * Resuelve la canasta fija CBA a productos concretos del catálogo.
 * Por cada rubro elige el representante con mayor cobertura de tiendas
 * (y a igual cobertura, el más barato).
 */
export async function resolveCbaBasket(db: KyselyDB): Promise<CbaResolvedProduct[]> {
  const candidates = await fetchCandidates(db);
  const resolved: CbaResolvedProduct[] = [];

  for (const item of CBA_ITEMS) {
    const pool = candidates.filter((c) => item.match.test(c.canonical_name));
    if (pool.length === 0) continue;
    pool.sort(
      (a, b) =>
        b.stores_count - a.stores_count ||
        a.best_price - b.best_price ||
        a.canonical_name.length - b.canonical_name.length,
    );
    const pick = pool[0];
    resolved.push({
      key: item.key,
      label: item.label,
      rubric: item.rubric,
      productId: pick.product_id,
      slug: pick.slug,
      canonicalName: pick.canonical_name,
      brand: pick.brand,
    });
  }

  return resolved;
}
