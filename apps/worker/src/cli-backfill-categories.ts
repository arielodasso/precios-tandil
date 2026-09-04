import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { matchCategoryByName } from './lib/category-map.ts';

/**
 * Backfill de categorías por nombre.
 *
 * El pipeline anterior dejaba `category_id = null` porque intentaba matchear
 * el path de categoría de la tienda (ej: "Almacén/Arroz") contra la taxonomía
 * propia (ej: "almacen/arroz") y nunca coincidía, y además el guard
 * `category_id is null` impedía reasignar categorías en rescrapes.
 *
 * El `category_path` de la tienda NO se persiste en la DB, así que para
 * productos ya scrapeados este script cataloga por el nombre: usa el
 * `canonical_name` del producto y, como mejor señal, el `raw_description`
 * original más largo de sus SKUs (el nombre de origen suele empezar con la
 * categoría, ej: "Arroz parboil Gallo oro 1 kg").
 *
 * Es un arreglo de datos (no sustituye el fix del pipeline).
 */

interface CategoryRow {
  id: number;
  path: string;
}

interface ProductRow {
  id: number;
  canonical_name: string;
}

interface SkuNameRow {
  product_id: number;
  raw_description: string;
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

// Recolecta el raw_description original más largo por producto (join store_sku -> match_link).
const skuRows = (await db
  .selectFrom('store_sku as ss')
  .innerJoin('match_link as ml', 'ml.store_sku_id', 'ss.id')
  .select(['ml.product_id as product_id', 'ss.raw_description'])
  .where('ml.status', 'in', ['auto', 'confirmed'])
  .execute()) as SkuNameRow[];

const nameByProduct = new Map<number, string>();
for (const row of skuRows) {
  const pid = Number(row.product_id);
  const cur = nameByProduct.get(pid);
  if (!cur || row.raw_description.length > cur.length) {
    nameByProduct.set(pid, row.raw_description);
  }
}

const byCategory = new Map<number, number[]>();
const unmapped: Array<{ path: string; name: string }> = [];
let assigned = 0;

for (const p of products) {
  const pid = Number(p.id);
  const signal = nameByProduct.get(pid) ?? p.canonical_name;
  const taxPath = matchCategoryByName(signal);
  if (!taxPath) {
    unmapped.push({ path: taxPath, name: p.canonical_name });
    continue;
  }
  const id = pathToId.get(taxPath);
  if (id === undefined) {
    unmapped.push({ path: taxPath, name: p.canonical_name });
    continue;
  }
  const list = byCategory.get(id) ?? [];
  list.push(Number(p.id));
  byCategory.set(id, list);
  assigned += 1;
}

for (const [id, ids] of byCategory) {
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += 500) batches.push(ids.slice(i, i + 500));
  for (const batch of batches) {
    await db
      .updateTable('product')
      .set({ category_id: Number(id) })
      .where('id', 'in', batch)
      .execute();
  }
}

logger.info({ assigned, total: products.length }, 'backfill de categorías completado');
for (const [id, ids] of byCategory) {
  logger.info(
    { path: categories.find((c) => Number(c.id) === id)?.path, count: ids.length },
    'categoría asignada',
  );
}
if (unmapped.length > 0) {
  logger.warn({ unmapped }, 'productos/categorías no mapeados');
}

await db.destroy();
