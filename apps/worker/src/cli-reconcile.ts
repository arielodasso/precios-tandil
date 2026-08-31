/**
 * Mantenimiento de la integridad del matching:
 *  - mergea productos duplicados que comparten el mismo EAN (elige el producto
 *    con más links como canónico y mueve sus match_links),
 *  - rechaza links `pending_review` que el matcher actual considera incorrectos
 *    (p.ej. arroz vs harina tras el bloqueo por tipo),
 *  - limpia productos huérfanos (0 links, sin deals) para no mostrar fantasmas.
 *
 * Uso:
 *   pnpm --filter @precios/worker reconcile            # dry-run (reporta)
 *   pnpm --filter @precios/worker reconcile --apply    # ejecuta los cambios
 */
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import {
  findBestMatch,
  normalizeDescription,
  semanticScore,
  type MatchCandidate,
} from '@precios/normalizer';

const APPLY = process.argv.includes('--apply');
const REJECT_CURRENT_BELOW = 0.45;

interface ProductRow {
  id: number;
  ean: string | null;
  canonical_name: string;
  brand: string | null;
  unit_amount: string | null;
  unit_type: string | null;
  image_url: string | null;
  image_hash: string | null;
  updated_at: Date;
  created_at: Date;
}

function toCandidate(p: ProductRow): MatchCandidate {
  const norm = normalizeDescription(p.canonical_name, { brand: p.brand });
  return {
    productId: p.id,
    ean: p.ean,
    normName: norm.normName,
    unitAmount: p.unit_amount !== null ? Number(p.unit_amount) : null,
    unitType: p.unit_type,
    brand: p.brand,
    typeKeys: norm.typeKeys,
    imageHash: p.image_hash,
    imageUrl: p.image_url,
    contextText: '',
  };
}

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

const counts = { merged: 0, movedLinks: 0, orphanRemoved: 0, rejected: 0, repaired: 0, skipped: 0 };

async function loadBaseline(): Promise<{
  products: ProductRow[];
  linkCounts: Map<string, number>;
}> {
  const products = (await db
    .selectFrom('product')
    .select([
      'id',
      'ean',
      'canonical_name',
      'brand',
      'unit_amount',
      'unit_type',
      'image_url',
      'image_hash',
      'updated_at',
      'created_at',
    ])
    .execute()) as unknown as ProductRow[];

  const linkCounts = new Map<string, number>();
  const links = await db.selectFrom('match_link').select(['product_id', 'status']).execute();
  for (const l of links) {
    const pid = String(l.product_id);
    linkCounts.set(pid, (linkCounts.get(pid) ?? 0) + 1);
  }
  return { products, linkCounts };
}

async function run() {
  // ---- 1) Duplicados por EAN ----
  const { products, linkCounts } = await loadBaseline();

  const byEan = new Map<string, ProductRow[]>();
  for (const p of products) {
    if (!p.ean) continue;
    const arr = byEan.get(p.ean) ?? [];
    arr.push(p);
    byEan.set(p.ean, arr);
  }

  logger.info(
    { dryRun: !APPLY, eanGroups: [...byEan.values()].filter((g) => g.length > 1).length },
    'reconcile: duplicados por EAN',
  );

  for (const [ean, group] of byEan) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => {
      const la = linkCounts.get(String(a.id)) ?? 0;
      const lb = linkCounts.get(String(b.id)) ?? 0;
      return lb - la || b.updated_at.getTime() - a.updated_at.getTime();
    });
    const keeper = sorted[0]!;
    logger.info(
      { ean, keeper: keeper.id, candidates: sorted.map((s) => s.id) },
      'reconcile: grupo EAN detectado',
    );

    for (const secondary of sorted.slice(1)) {
      const hasDeal = await dealReferences(secondary.id);
      const move = {
        from: secondary.id,
        to: keeper.id,
        links: linkCounts.get(String(secondary.id)) ?? 0,
        hasDeal,
      };
      counts.merged++;
      if (hasDeal) counts.skipped++;
      logger.info({ ...move }, APPLY ? 'reconcile: Aplicando merge' : 'reconcile: would-merge');
      if (!APPLY) continue;

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('match_link')
          .set({ product_id: keeper.id })
          .where('product_id', '=', secondary.id)
          .execute();
        await trx.deleteFrom('price_aggregate').where('product_id', '=', secondary.id).execute();
        if (!hasDeal) {
          await trx.deleteFrom('product').where('id', '=', secondary.id).execute();
        }
      });
    }
  }

  // ---- 2) Rechazar links pending_review que quedaron mal emparejados ----
  // Se reconstruye el baseline DESPUÉS de la fase 1: algún producto pudo ser
  // eliminado por un merge de EAN y no debe actuar como candidato.
  const after = await loadBaseline();
  const candidates = new Map(after.products.map((p) => [String(p.id), toCandidate(p)]));
  const candArray = [...candidates.values()];
  const pending = (await db
    .selectFrom('match_link')
    .innerJoin('store_sku', 'store_sku.id', 'match_link.store_sku_id')
    .select([
      'match_link.id',
      'match_link.product_id',
      'store_sku.id as sku_id',
      'store_sku.store_id',
      'store_sku.raw_description',
      'store_sku.description',
      'store_sku.declared_ean',
    ])
    .where('match_link.status', '=', 'pending_review')
    .execute()) as unknown as Array<{
    id: number;
    product_id: number;
    sku_id: number;
    store_id: number;
    raw_description: string;
    description: string | null;
    declared_ean: string | null;
  }>;

  logger.info(
    { dryRun: !APPLY, pendingLinks: pending.length },
    'reconcile: re-evaluando links pendientes',
  );
  for (const link of pending) {
    const current = candidates.get(String(link.product_id));
    if (!current) continue;

    const norm = normalizeDescription(link.raw_description, {
      description: link.description,
    });
    const curScore = semanticScore(norm, current);
    const outcome = findBestMatch(norm, link.declared_ean ?? undefined, candArray);

    if (curScore < REJECT_CURRENT_BELOW) {
      counts.rejected++;
      logger.info(
        { linkId: link.id, skuId: link.sku_id, productId: current.productId, score: curScore },
        APPLY ? 'reconcile: rechazando link' : 'reconcile: would-reject',
      );
      if (APPLY) {
        await db
          .updateTable('match_link')
          .set({ status: 'rejected', decided_by: 'reconcile-cli', decided_at: new Date() })
          .where('id', '=', link.id)
          .execute();
      }
      continue;
    }

    const better =
      (outcome.method === 'ean' && outcome.productId !== current.productId) ||
      (outcome.method === 'semantic' &&
        outcome.productId !== current.productId &&
        outcome.score >= 0.82);
    if (better) {
      counts.repaired++;
      logger.info(
        { linkId: link.id, skuId: link.sku_id, from: current.productId, to: outcome.productId },
        APPLY ? 'reconcile: reparando link' : 'reconcile: would-repair',
      );
      if (APPLY) {
        const target = outcome.productId;
        if (target !== null) {
          await db
            .updateTable('match_link')
            .set({
              product_id: target,
              method: outcome.method === 'ean' ? 'ean' : 'semantic',
              status: 'auto',
              decided_by: 'reconcile-cli',
              decided_at: new Date(),
            })
            .where('id', '=', link.id)
            .execute();
        }
      }
    }
  }

  // ---- 3) Huérfanos (0 links, sin deals, viejos) ----
  const cutOff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const orphanIds: string[] = [];
  for (const p of after.products) {
    if ((after.linkCounts.get(String(p.id)) ?? 0) > 0) continue;
    if (p.created_at > cutOff) continue;
    if (await dealReferences(Number(p.id))) continue;
    orphanIds.push(String(p.id));
  }
  counts.orphanRemoved = orphanIds.length;
  logger.info({ dryRun: !APPLY, orphans: orphanIds.length }, 'reconcile: limpieza de huérfanos');
  if (APPLY && orphanIds.length > 0) {
    await db.deleteFrom('product').where('id', 'in', orphanIds.map(Number)).execute();
  }

  logger.info(counts, 'reconcile: resumen');
}

async function dealReferences(productId: number | string): Promise<boolean> {
  const row = await db
    .selectFrom('deal_candidate')
    .select('id')
    .where('product_id', '=', Number(productId))
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

run()
  .catch((err) => {
    logger.error({ err }, 'reconcile falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
