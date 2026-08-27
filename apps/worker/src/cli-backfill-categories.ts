import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';

/**
 * Backfill de categorías por nombre.
 *
 * Los productos existentes quedaron sin `category_id` porque el pipeline
 * intentaba matchear el path de categoría de la tienda (ej: "Almacén/Arroz")
 * contra la taxonomía propia (ej: "almacen/arroz") y nunca coincidía.
 *
 * Este script asigna cada producto a la categoría de la taxonomía local que
 * mejor lo describe, a partir de su nombre canónico. Es un arreglo de datos
 * (no sustituye el fix del pipeline, solo corrige los productos ya scrapeados).
 */

interface Rule {
  categoryPath: string;
  prefixes: string[];
}

// Ordenadas de más específica a menos específica.
const RULES: Rule[] = [
  { categoryPath: 'almacen/arroz', prefixes: ['arroz'] },
  { categoryPath: 'almacen/aceite', prefixes: ['aceite'] },
  { categoryPath: 'almacen/azucar', prefixes: ['azucar', 'edulcorante', 'endulzan', 'stevia'] },
  { categoryPath: 'almacen/yerba', prefixes: ['yerba', 'mate cocido'] },
  { categoryPath: 'bebidas/gaseosas', prefixes: ['gaseosa'] },
  { categoryPath: 'lacteos', prefixes: ['leche', 'queso'] },
  { categoryPath: 'frescos', prefixes: ['pan'] },
];

const DEFAULT_PATH = 'almacen';

interface CategoryRow {
  id: number;
  path: string;
}

interface ProductRow {
  id: number;
  canonical_name: string;
}

function matchPath(name: string): string {
  const n = name.toLowerCase().trim();
  for (const rule of RULES) {
    if (rule.prefixes.some((p) => n.startsWith(p))) return rule.categoryPath;
  }
  return DEFAULT_PATH;
}

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

const categories = (await db
  .selectFrom('category')
  .select(['id', 'path'])
  .execute()) as CategoryRow[];
const pathToId = new Map(categories.map((c) => [c.path, Number(c.id)]));

const products = (await db
  .selectFrom('product')
  .select(['id', 'canonical_name'])
  .execute()) as ProductRow[];

const byCategory = new Map<string, number[]>();
const unmapped: string[] = [];
let assigned = 0;

for (const p of products) {
  const path = matchPath(p.canonical_name);
  const id = pathToId.get(path);
  if (id === undefined) {
    unmapped.push(`${path} (${p.canonical_name})`);
    continue;
  }
  const list = byCategory.get(path) ?? [];
  list.push(Number(p.id));
  byCategory.set(path, list);
  await db.updateTable('product').set({ category_id: id }).where('id', '=', Number(p.id)).execute();
  assigned += 1;
}

logger.info({ assigned, total: products.length }, 'backfill de categorías completado');
for (const [path, ids] of byCategory) {
  logger.info({ path, count: ids.length }, 'categoría asignada');
}
if (unmapped.length > 0) {
  logger.warn({ unmapped }, 'productos/categorías no mapeados');
}

await db.destroy();
