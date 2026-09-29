/**
 * Diagnóstico READ-ONLY de store_sku huérfanos históricos.
 *
 * NO modifica datos. Solo lee y reporta estadísticas.
 *
 * Uso:
 *   pnpm --filter @precios/worker diagnose-orphans
 *   pnpm --filter @precios/worker diagnose-orphans --store=vea
 */
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { sql } from 'kysely';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

const storeArg = process.argv.find((a) => a.startsWith('--store='));
const STORE_SLUG = storeArg ? storeArg.split('=')[1] : null;

interface OrphanSku {
  sku_id: number;
  store_id: number;
  store_slug: string;
  external_id: string;
  declared_ean: string | null;
  raw_description: string;
  price_count: number;
}

async function main() {
  logger.info({ store: STORE_SLUG }, 'diagnose-orphans: inicio');

  const storeFilter = STORE_SLUG ? sql`AND s.slug = ${STORE_SLUG}` : sql``;

  // 1. Resumen general
  const summary = await sql<{
    total_store_sku: number;
    with_product: number;
    orphan_skus: number;
    orphan_with_ean: number;
    orphan_without_ean: number;
    orphan_with_valid_ean: number;
    orphan_price_records: number;
  }>`
    SELECT 
      COUNT(*) as total_store_sku,
      COUNT(*) FILTER (WHERE ml.id IS NOT NULL) as with_product,
      COUNT(*) FILTER (WHERE ml.id IS NULL) as orphan_skus,
      COUNT(*) FILTER (WHERE ml.id IS NULL AND ss.declared_ean IS NOT NULL) as orphan_with_ean,
      COUNT(*) FILTER (WHERE ml.id IS NULL AND ss.declared_ean IS NULL) as orphan_without_ean,
      COUNT(*) FILTER (WHERE ml.id IS NULL AND ss.declared_ean IS NOT NULL AND ss.declared_ean::text ~ '^\d{13}$') as orphan_with_valid_ean,
      COUNT(pr.id) FILTER (WHERE ml.id IS NULL) as orphan_price_records
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
    WHERE ss.is_active = true
    ${storeFilter};
  `.execute(db);

  logger.info(summary.rows[0], 'diagnose-orphans: resumen general');

  // 2. Matches por EAN normalizado (product.ean = lpad(store_sku.declared_ean, 13, '0'))
  const eanMatches = await sql<{
    count: number;
    price_records: number;
  }>`
    SELECT 
      COUNT(DISTINCT ss.id) as count,
      COUNT(pr.id) as price_records
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    JOIN product p ON p.ean::text = lpad(ss.declared_ean::text, 13, '0')
    LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ss.is_active = true
      AND ml.id IS NULL
      AND ss.declared_ean IS NOT NULL
      ${storeFilter};
  `.execute(db);

  logger.info(eanMatches.rows[0], 'diagnose-orphans: matches por EAN normalizado (13 dígitos)');

  // 3. Matches por EAN exacto (sin normalizar - para comparar)
  const eanExactMatches = await sql<{
    count: number;
    price_records: number;
  }>`
    SELECT 
      COUNT(DISTINCT ss.id) as count,
      COUNT(pr.id) as price_records
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    JOIN product p ON p.ean = ss.declared_ean
    LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ss.is_active = true
      AND ml.id IS NULL
      AND ss.declared_ean IS NOT NULL
      ${storeFilter};
  `.execute(db);

  logger.info(eanExactMatches.rows[0], 'diagnose-orphans: matches por EAN exacto (sin normalizar)');

  // 4. SKUs huérfanos con EAN de 13 dígitos válidos (candidatos para match semántico)
  const validEanOrphans = await sql<OrphanSku>`
    SELECT 
      ss.id as sku_id,
      ss.store_id,
      s.slug as store_slug,
      ss.external_id,
      ss.declared_ean,
      ss.raw_description,
      COUNT(pr.id) as price_count
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ss.is_active = true
      AND ml.id IS NULL
      AND ss.declared_ean IS NOT NULL
      AND ss.declared_ean::text ~ '^\d{13}$'
      ${storeFilter}
    GROUP BY ss.id, ss.store_id, s.slug, ss.external_id, ss.declared_ean, ss.raw_description
    ORDER BY price_count DESC
    LIMIT 20;
  `.execute(db);

  logger.info(
    { count: validEanOrphans.rows.length, sample: validEanOrphans.rows.slice(0, 5) },
    'diagnose-orphans: muestra de huérfanos con EAN válido (13 dígitos)',
  );

  // 5. SKUs huérfanos SIN EAN
  const noEanOrphans = await sql<OrphanSku>`
    SELECT 
      ss.id as sku_id,
      ss.store_id,
      s.slug as store_slug,
      ss.external_id,
      ss.declared_ean,
      ss.raw_description,
      COUNT(pr.id) as price_count
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ss.is_active = true
      AND ml.id IS NULL
      AND ss.declared_ean IS NULL
      ${storeFilter}
    GROUP BY ss.id, ss.store_id, s.slug, ss.external_id, ss.declared_ean, ss.raw_description
    ORDER BY price_count DESC
    LIMIT 20;
  `.execute(db);

  logger.info(
    { count: noEanOrphans.rows.length, sample: noEanOrphans.rows.slice(0, 5) },
    'diagnose-orphans: muestra de huérfanos SIN EAN',
  );

  // 6. Distribución de longitudes de EAN en huérfanos
  const eanLengths = await sql<{ length: number; count: number }>`
    SELECT 
      LENGTH(ss.declared_ean::text) as length,
      COUNT(*) as count
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ss.is_active = true
      AND ml.id IS NULL
      AND ss.declared_ean IS NOT NULL
      ${storeFilter}
    GROUP BY LENGTH(ss.declared_ean::text)
    ORDER BY length;
  `.execute(db);

  logger.info(
    { distribution: eanLengths.rows },
    'diagnose-orphans: distribución de longitudes de EAN en huérfanos',
  );

  // 7. EANs distintos entre huérfanos
  const distinctEans = await sql<{ count: number }>`
    SELECT COUNT(DISTINCT ss.declared_ean) as count
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ss.is_active = true
      AND ml.id IS NULL
      AND ss.declared_ean IS NOT NULL
      ${storeFilter};
  `.execute(db);

  logger.info(distinctEans.rows[0], 'diagnose-orphans: EANs distintos entre huérfanos');

  // 8. Top EANs en huérfanos con más price_records
  const topOrphanEans = await sql<{
    declared_ean: string;
    sku_count: number;
    price_count: number;
  }>`
    SELECT 
      ss.declared_ean,
      COUNT(DISTINCT ss.id) as sku_count,
      COUNT(pr.id) as price_count
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ss.is_active = true
      AND ml.id IS NULL
      AND ss.declared_ean IS NOT NULL
      ${storeFilter}
    GROUP BY ss.declared_ean
    ORDER BY price_count DESC
    LIMIT 20;
  `.execute(db);

  logger.info(
    { topEans: topOrphanEans.rows },
    'diagnose-orphans: top EANs huérfanos por price_records',
  );

  // 9. Productos que SÍ tienen match_link (para comparar)
  const matchedSummary = await sql<{
    products_matched: number;
    skus_matched: number;
    price_records_matched: number;
  }>`
    SELECT 
      COUNT(DISTINCT p.id) as products_matched,
      COUNT(DISTINCT ss.id) as skus_matched,
      COUNT(pr.id) as price_records_matched
    FROM product p
    JOIN match_link ml ON ml.product_id = p.id
    JOIN store_sku ss ON ss.id = ml.store_sku_id
    LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
    WHERE ss.is_active = true
      AND ml.status IN ('auto', 'confirmed');
  `.execute(db);

  logger.info(matchedSummary.rows[0], 'diagnose-orphans: productos con match activo');

  await db.destroy();
}

main()
  .catch((err) => {
    logger.error({ err }, 'diagnose-orphans falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
