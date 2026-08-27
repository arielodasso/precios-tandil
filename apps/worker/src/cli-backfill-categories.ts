import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { matchCategoryByName } from './lib/category-map.ts';

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

interface CategoryRow {
  id: number;
  path: string;
}

interface ProductRow {
  id: number;
  canonical_name: string;
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
  const path = matchCategoryByName(p.canonical_name);
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
