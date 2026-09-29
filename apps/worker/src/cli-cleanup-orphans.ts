/**
 * CLI para limpiar store_sku huérfanos y asociarlos a productos existentes.
 *
 * Usa las vistas creadas en la migración 0010 para identificar SKUs que pueden
 * asociarse de forma segura y los que no.
 *
 * Uso:
 *   pnpm --filter @precios/worker cleanup-orphans           # dry-run (reporta)
 *   pnpm --filter @precios/worker cleanup-orphans --apply   # ejecuta los cambios
 *   pnpm --filter @precios/worker cleanup-orphans --store=vea  # solo una tienda
 */
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { sql } from 'kysely';

const APPLY = process.argv.includes('--apply');
const storeArg = process.argv.find((a) => a.startsWith('--store='));
const STORE_SLUG = storeArg ? storeArg.split('=')[1] : null;

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

interface OrphanSku {
  sku_id: number;
  store_id: number;
  store_slug: string;
  external_id: string;
  declared_ean: string | null;
  raw_description: string;
  price_count: number;
  product_id: number; // non-null for matchable views
  canonical_name: string | null;
  brand: string | null;
  match_method: string | null;
  match_score: number | null;
  product_ean: string | null; // from the view
}

async function main() {
  logger.info({ dryRun: !APPLY, store: STORE_SLUG }, 'cleanup-orphans: inicio');

  // 1. Resumen general
  const summary = await sql<{
    total_orphan_skus: number;
    matchable_by_ean: number;
    matchable_semantic: number;
    unmatchable: number;
    duplicate_groups: number;
    total_duplicate_skus: number;
    orphan_price_records: number;
    price_record_size: string;
    store_sku_size: string;
  }>`
    SELECT * FROM v_orphan_cleanup_summary
  `.execute(db);

  logger.info(summary.rows[0], 'cleanup-orphans: resumen general');

  // 2. SKUs que se pueden asociar por EAN (alta confianza)
  const eanMatches = await sql<OrphanSku>`
    SELECT * FROM v_orphan_matchable_by_ean
    ${STORE_SLUG ? sql`WHERE store_slug = ${STORE_SLUG}` : sql``}
    ORDER BY price_count DESC
  `.execute(db);

  logger.info(
    { count: eanMatches.rows.length, dryRun: !APPLY },
    'cleanup-orphans: matches por EAN',
  );

  // 3. SKUs que se pueden asociar semánticamente (revisión manual)
  const semanticMatches = await sql<OrphanSku>`
    SELECT * FROM v_orphan_matchable_semantic
    ${STORE_SLUG ? sql`WHERE store_slug = ${STORE_SLUG}` : sql``}
    ORDER BY price_count DESC
  `.execute(db);

  logger.info(
    { count: semanticMatches.rows.length, dryRun: !APPLY },
    'cleanup-orphans: matches semánticos (requieren revisión)',
  );

  // 4. SKUs verdaderamente huérfanos
  const unmatchable = await sql<OrphanSku>`
    SELECT * FROM v_orphan_unmatchable
    ${STORE_SLUG ? sql`WHERE store_slug = ${STORE_SLUG}` : sql``}
    ORDER BY price_count DESC
  `.execute(db);

  logger.info(
    { count: unmatchable.rows.length, dryRun: !APPLY },
    'cleanup-orphans: sin match posible',
  );

  // 5. Duplicados
  const duplicates = await sql<{
    store_id: number;
    external_id: string;
    dup_count: number;
    sku_ids: number[];
    seen_dates: Date[];
  }>`
    SELECT * FROM v_duplicate_store_sku
    ${STORE_SLUG ? sql`WHERE store_id = (SELECT id FROM store WHERE slug = ${STORE_SLUG})` : sql``}
    ORDER BY dup_count DESC
  `.execute(db);

  logger.info(
    { count: duplicates.rows.length, dryRun: !APPLY },
    'cleanup-orphans: grupos duplicados',
  );

  // 6. Aplicar cambios si --apply
  if (APPLY) {
    let applied = 0;
    let errors = 0;

    // 6a. Asociar matches por EAN (seguros)
    for (const match of eanMatches.rows) {
      try {
        await db.transaction().execute(async (trx) => {
          // Verificar que no exista ya un match_link para este SKU
          const existing = await trx
            .selectFrom('match_link')
            .select('id')
            .where('store_sku_id', '=', match.sku_id)
            .executeTakeFirst();

          if (existing) return;

          await trx
            .insertInto('match_link')
            .values({
              store_sku_id: match.sku_id,
              product_id: match.product_id,
              method: 'ean',
              score: '1.0000',
              status: 'auto',
            })
            .execute();

          // Actualizar declared_ean en store_sku si es null pero product tiene EAN
          if (match.declared_ean === null && match.product_ean) {
            await trx
              .updateTable('store_sku')
              .set({ declared_ean: match.product_ean })
              .where('id', '=', match.sku_id)
              .execute();
          }
        });
        applied++;
      } catch (err) {
        errors++;
        logger.error({ skuId: match.sku_id, err }, 'cleanup-orphans: error asociando por EAN');
      }
    }

    logger.info({ applied, errors }, 'cleanup-orphans: asociados por EAN');

    // 6b. Asociar matches semánticos (solo si score alto y revisión manual)
    // NOTA: Estos requieren revisión manual, se marcan como pending_review
    let semApplied = 0;
    for (const match of semanticMatches.rows) {
      if (match.match_score !== null && match.match_score >= 0.85) {
        const score = match.match_score; // narrow type
        try {
          await db.transaction().execute(async (trx) => {
            const existing = await trx
              .selectFrom('match_link')
              .select('id')
              .where('store_sku_id', '=', match.sku_id)
              .executeTakeFirst();

            if (existing) return;

            await trx
              .insertInto('match_link')
              .values({
                store_sku_id: match.sku_id,
                product_id: match.product_id,
                method: 'semantic',
                score: score.toFixed(4),
                status: 'pending_review',
              })
              .execute();
          });
          semApplied++;
        } catch (err) {
          errors++;
          logger.error({ skuId: match.sku_id, err }, 'cleanup-orphans: error asociando semántico');
        }
      }
    }

    logger.info(
      { applied: semApplied, errors },
      'cleanup-orphans: asociados semánticos (pending_review)',
    );

    // 6c. Limpiar duplicados (mantener el más reciente)
    let deduped = 0;
    for (const dup of duplicates.rows) {
      const rawIds = dup.sku_ids;
      if (!rawIds || rawIds.length < 2) continue;
      const skuIds = rawIds.filter((id): id is number => id !== undefined && id !== null);
      if (skuIds.length < 2) continue;
      const keepId = skuIds[0]!;
      const removeIds = skuIds.slice(1);

      try {
        await db.transaction().execute(async (trx) => {
          // Mover precios y match_links al SKU principal
          for (const removeId of removeIds) {
            // Verificar si tiene match_link
            const link = await trx
              .selectFrom('match_link')
              .select(['product_id', 'id'])
              .where('store_sku_id', '=', removeId)
              .executeTakeFirst();

            if (link) {
              // Si el SKU principal ya tiene link, eliminar el duplicado
              const mainLink = await trx
                .selectFrom('match_link')
                .select('id')
                .where('store_sku_id', '=', keepId)
                .executeTakeFirst();

              if (mainLink) {
                await trx.deleteFrom('match_link').where('id', '=', link.id).execute();
              } else {
                await trx
                  .updateTable('match_link')
                  .set({ store_sku_id: keepId })
                  .where('id', '=', link.id)
                  .execute();
              }
            }

            // Mover precios
            await trx
              .updateTable('price_record')
              .set({ store_sku_id: keepId })
              .where('store_sku_id', '=', removeId)
              .execute();

            // Desactivar SKU duplicado
            await trx
              .updateTable('store_sku')
              .set({ is_active: false })
              .where('id', '=', removeId)
              .execute();
          }
        });
        deduped += removeIds.length;
      } catch (err) {
        errors++;
        logger.error({ keepId, removeIds, err }, 'cleanup-orphans: error deduplicando');
      }
    }

    logger.info({ deduped, errors }, 'cleanup-orphans: SKUs duplicados desactivados');

    // 7. Resumen final
    const finalSummary = await sql<{
      total_orphan_skus: number;
      matchable_by_ean: number;
      matchable_semantic: number;
      unmatchable: number;
      duplicate_groups: number;
      total_duplicate_skus: number;
      orphan_price_records: number;
    }>`
      SELECT * FROM v_orphan_cleanup_summary
    `.execute(db);

    logger.info(finalSummary.rows[0], 'cleanup-orphans: resumen final');
  }

  await db.destroy();
}

main()
  .catch((err) => {
    logger.error({ err }, 'cleanup-orphans falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
