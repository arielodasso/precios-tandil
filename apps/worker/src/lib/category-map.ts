/**
 * Resolución de categorías de la taxonomía local.
 *
 * La taxonomía local usa slugs (ej: `almacen/arroz`, `lacteos`, `perfumeria`)
 * mientras que los adapters reportan el path de categoría con los nombres
 * visibles de cada tienda (ej: `["Almacén","Arroz"]`, `["Lácteos","Leche"]`,
 * `["Higiene","Shampoo"]`). Por eso el match exacto nunca coincidía y los
 * productos quedaban con `category_id = null`.
 *
 * Este módulo mapea esos tokens de tienda (y, en última instancia, el nombre
 * del producto) a un path de la taxonomía local.
 */

export interface CategoryRule {
  categoryPath: string;
  prefixes: string[];
}

// ---- Match por nombre de producto (fallback) ----
const NAME_RULES: CategoryRule[] = [
  { categoryPath: 'almacen/arroz', prefixes: ['arroz'] },
  { categoryPath: 'almacen/aceite', prefixes: ['aceite'] },
  {
    categoryPath: 'almacen/azucar',
    prefixes: ['azucar', 'edulcorante', 'endulzan', 'stevia', 'sucralosa'],
  },
  { categoryPath: 'almacen/yerba', prefixes: ['yerba', 'mate cocido'] },
  { categoryPath: 'bebidas/gaseosas', prefixes: ['gaseosa', 'cola', 'soda'] },
  {
    categoryPath: 'bebidas',
    prefixes: ['agua', 'jugo', 'bebida', 'cerveza', 'vino', 'fernet', 'whisky', 'gin'],
  },
  {
    categoryPath: 'lacteos',
    prefixes: ['leche', 'queso', 'yogur', 'yogrt', 'manteca', 'postre', 'flan', 'dulce de leche'],
  },
  {
    categoryPath: 'frescos/carnes',
    prefixes: [
      'carne',
      'cerdo',
      'pollo',
      'milanesa',
      'hamburguesa',
      'salchicha',
      'chorizo',
      'jamon',
      'fiambre',
    ],
  },
  {
    categoryPath: 'frescos',
    prefixes: [
      'pan',
      'verdura',
      'fruta',
      'huevo',
      'legumbre',
      'lechuga',
      'papa',
      'cebolla',
      'banana',
      'tomate fresco',
    ],
  },
  {
    categoryPath: 'congelados',
    prefixes: ['congelado', 'helado', 'prepizza', 'empanada', 'nuggets', 'papas fritas'],
  },
  {
    categoryPath: 'limpieza',
    prefixes: [
      'detergente',
      'lavandina',
      'suavizante',
      'limpiador',
      'limpia',
      'esponja',
      'bolsa de residuo',
      'lavandina',
    ],
  },
  {
    categoryPath: 'perfumeria',
    prefixes: [
      'shampoo',
      'shampu',
      'acondicionador',
      'dentifrico',
      'pasta dental',
      'desodorante',
      'enjuague',
      'papel higienico',
      'toallas femeninas',
      'alcohol en gel',
      'jabon de tocador',
    ],
  },
];

const NAME_DEFAULT = 'almacen';

/** Normaliza un token: minúsculas y sin acentos. */
export function normalizeToken(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Devuelve el path de taxonomía según el nombre del producto. */
export function matchCategoryByName(name: string): string {
  const n = normalizeToken(name);
  for (const rule of NAME_RULES) {
    if (rule.prefixes.some((p) => n.startsWith(p))) return rule.categoryPath;
  }
  return NAME_DEFAULT;
}

// ---- Match por path de categoría de la tienda ----
// path de taxonomía -> tokens normalizados que lo identifican.
const STORE_ALIASES: Array<{ path: string; tokens: string[] }> = [
  { path: 'almacen/aceite', tokens: ['aceite', 'aceites', 'aceites-y-vinagres', 'vinagres'] },
  { path: 'almacen/arroz', tokens: ['arroz', 'arroces', 'arroz-y-legumbres', 'legumbres'] },
  {
    path: 'almacen/azucar',
    tokens: ['azucar', 'edulcorante', 'edulcorantes', 'azucar-y-edulcorantes'],
  },
  {
    path: 'almacen/yerba',
    tokens: ['yerba', 'yerbas', 'yerba-y-infusiones', 'mate', 'infusiones'],
  },
  { path: 'bebidas/gaseosas', tokens: ['gaseosa', 'gaseosas', 'soda'] },
  { path: 'bebidas', tokens: ['bebida', 'bebidas', 'aguas', 'jugos'] },
  {
    path: 'frescos/carnes',
    tokens: ['carne', 'carnes', 'carniceria', 'polleria', 'fiambreria'],
  },
  {
    path: 'frescos',
    tokens: ['frescos', 'panaderia', 'verduleria', 'frutas', 'verduras', 'huevos'],
  },
  {
    path: 'lacteos',
    tokens: [
      'lacteo',
      'lacteos',
      'leche',
      'leches',
      'queso',
      'quesos',
      'yogur',
      'yoghurt',
      'manteca',
    ],
  },
  { path: 'congelados', tokens: ['congelado', 'congelados', 'freezer', 'freezers'] },
  {
    path: 'limpieza',
    tokens: [
      'limpieza',
      'lavanderia',
      'detergente',
      'detergentes',
      'lavandinas',
      'higiene-del-hogar',
    ],
  },
  {
    path: 'perfumeria',
    tokens: [
      'perfumeria',
      'belleza',
      'cuidado-personal',
      'higiene-personal',
      'shampoo',
      'cuidado-e-higiene-cabello',
      'higiene-bucal',
      'tocador',
    ],
  },
];

/** Devuelve el path de taxonomía a partir del path de categoría de la tienda. */
export function matchCategoryByStorePath(categoryPath: string[] | undefined): string | null {
  if (!categoryPath || categoryPath.length === 0) return null;
  const normed = categoryPath.map(normalizeToken).filter(Boolean);
  let best: { path: string; rank: number } | null = null;
  for (const alias of STORE_ALIASES) {
    for (const token of alias.tokens) {
      const hit = normed.some((t) => t === token || t.includes(token) || token.includes(t));
      if (hit) {
        const rank = alias.path.split('/').length;
        if (!best || rank > best.rank) best = { path: alias.path, rank };
      }
    }
  }
  return best?.path ?? null;
}
