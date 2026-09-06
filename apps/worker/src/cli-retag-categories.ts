import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { matchCategoryByName } from './lib/category-map.ts';

/**
 * Re-tag masivo de categorías por nombre (fix de clasificación).
 *
 * Antecedente: el matcher por path de tienda usaba substring sueltos y
 * clasificaba mal (pañales en frescos/panaderia, paños/panuelos en panaderia,
 * etc.). El path de categoría de la tienda NO se persiste en la DB, así que
 * este script recalcula la categoría desde el mejor nombre disponible:
 * el `raw_description` original más largo de sus SKUs (suele empezar con la
 * categoría o el producto), con `canonical_name` como fallback.
 *
 * Estrategia híbrida para no degradar lo ya correcto:
 *  - si el nombre deriva a una categoría concreta (no el default 'almacen'),
 *    se asigna esa categoría (corrige pañales, paños, grisines, alcohol, ...);
 *  - si el nombre no aporta señal (queda en default 'almacen'), se conserva la
 *    categoría actual (evita perder frescos cortos como 'falda' o 'kiwi').
 *
 * Uso: pnpm retag-categories            # dry-run (solo reporte)
 *      pnpm retag-categories -- --apply # escribe los cambios en la DB
 */

interface CategoryRow {
  id: number;
  path: string;
}

interface ProductRow {
  id: number;
  canonical_name: string;
  category_id: number | null;
}

interface SkuNameRow {
  product_id: number;
  raw_description: string;
}

const DEFAULT_PATH = 'almacen';

async function main() {
  const apply = process.argv.includes('--apply');
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  const categories = (await db
    .selectFrom('category')
    .select(['id', 'path'])
    .execute()) as CategoryRow[];
  const pathToId = new Map(categories.map((c) => [c.path, Number(c.id)]));
  const idToPath = new Map(categories.map((c) => [Number(c.id), c.path]));

  const products = (await db
    .selectFrom('product')
    .select(['id', 'canonical_name', 'category_id'])
    .execute()) as ProductRow[];

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

  const moves = new Map<string, { from: string; to: string; names: string[] }>();
  const untouched = new Map<string, number>();
  const missingRule: Array<{ from: string; name: string; signal: string }> = [];

  for (const p of products) {
    const pid = Number(p.id);
    const currentPath = p.category_id !== null ? idToPath.get(Number(p.category_id)) : null;
    if (currentPath === undefined) continue;
    const signal = nameByProduct.get(pid) ?? p.canonical_name;
    const candidate = matchCategoryByName(signal);

    if (candidate === DEFAULT_PATH) {
      // Sin señal de nombre: conservar categoría actual.
      if (currentPath !== null) {
        untouched.set(currentPath, (untouched.get(currentPath) ?? 0) + 1);
      } else {
        missingRule.push({ from: '(sin categoría)', name: p.canonical_name, signal });
      }
      continue;
    }

    if (currentPath !== candidate) {
      const key = `${currentPath ?? '(sin categoría)'} -> ${candidate}`;
      const entry = moves.get(key) ?? {
        from: currentPath ?? '(sin categoría)',
        to: candidate,
        names: [],
      };
      entry.names.push(`${p.canonical_name} | ${signal}`);
      moves.set(key, entry);
    } else {
      const key = currentPath;
      untouched.set(key, (untouched.get(key) ?? 0) + 1);
    }
  }

  const ordered = [...moves.entries()].sort((a, b) => b[1].names.length - a[1].names.length);
  logger.info(
    { total: products.length, movimientos: ordered.reduce((s, [, v]) => s + v.names.length, 0) },
    'resumen re-tag',
  );
  for (const [, v] of ordered) {
    logger.info({ de: v.from, a: v.to, cantidad: v.names.length }, 'movimiento');
    for (const n of v.names.slice(0, 10)) logger.info({ ejemplo: n }, '  └');
  }

  if (missingRule.length > 0) {
    logger.warn(
      { sinCategoriaYconDefault: missingRule.length },
      'productos sin categoría actual y sin señal de nombre',
    );
    for (const m of missingRule.slice(0, 20)) logger.warn(m);
  }

  if (!apply) {
    logger.info('dry-run: no se escribieron cambios (usar --apply para aplicarlos)');
    await db.destroy();
    return;
  }

  let applied = 0;
  for (const v of moves.values()) {
    const toId = pathToId.get(v.to);
    if (toId === undefined) continue;
    const ids = products
      .filter((p) => {
        const cur = p.category_id !== null ? idToPath.get(Number(p.category_id)) : null;
        if (cur === undefined || cur === v.to) return false;
        const signal = nameByProduct.get(Number(p.id)) ?? p.canonical_name;
        return matchCategoryByName(signal) === v.to;
      })
      .map((p) => Number(p.id));
    if (ids.length === 0) continue;
    const batches: number[][] = [];
    for (let i = 0; i < ids.length; i += 500) batches.push(ids.slice(i, i + 500));
    for (const batch of batches) {
      await db.updateTable('product').set({ category_id: toId }).where('id', 'in', batch).execute();
    }
    applied += ids.length;
    logger.info({ to: v.to, cantidad: ids.length }, 'actualizado');
  }

  logger.info({ applied, total: products.length }, 're-tag aplicado');
  await db.destroy();
}

await main();
