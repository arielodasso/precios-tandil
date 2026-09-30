'use strict';

/**
 * Migration 0010: Clean up orphaned store_sku and associate with products where possible
 *
 * This migration provides a SAFE strategy to clean up the 100K+ orphaned store_sku records
 * that have prices but no product_id. It does NOT delete data automatically.
 *
 * Run with: pnpm --filter @precios/db migrate up 0010
 *
 * After running, review the generated views and run the manual cleanup steps.
 */

export async function up(pgm) {
  // 1. Create a view to analyze orphaned store_sku with their EANs
  await pgm.sql(`
    CREATE OR REPLACE VIEW v_orphan_store_sku AS
    SELECT 
      ss.id as sku_id,
      ss.store_id,
      s.slug as store_slug,
      ss.external_id,
      ss.declared_ean,
      ss.raw_description,
      ss.description,
      ss.url,
      ss.last_seen_at,
      ss.is_active,
      COUNT(pr.id) as price_count,
      MIN(pr.captured_at) as first_price_date,
      MAX(pr.captured_at) as last_price_date
    FROM store_sku ss
    JOIN store s ON s.id = ss.store_id
    LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ml.id IS NULL
      AND ss.is_active = true
    GROUP BY ss.id, ss.store_id, s.slug, ss.external_id, ss.declared_ean, ss.raw_description, ss.description, ss.url, ss.last_seen_at, ss.is_active
    HAVING COUNT(pr.id) > 0
    ORDER BY price_count DESC;
  `);

  // 2. Create a view showing which orphaned SKUs can be matched by EAN to existing products
  await pgm.sql(`
    CREATE OR REPLACE VIEW v_orphan_matchable_by_ean AS
    SELECT 
      o.sku_id,
      o.store_id,
      o.store_slug,
      o.external_id,
      o.declared_ean,
      o.raw_description,
      o.price_count,
      p.id as product_id,
      p.canonical_name,
      p.brand,
      p.ean as product_ean,
      'ean' as match_method,
      1.0 as match_score
    FROM v_orphan_store_sku o
    JOIN product p ON p.ean = o.declared_ean
    WHERE o.declared_ean IS NOT NULL
      AND o.declared_ean ~ '^[0-9]{13}$'
    ORDER BY o.price_count DESC;
  `);

  // 3. Create a view showing orphaned SKUs that could match semantically (high confidence)
  await pgm.sql(`
    CREATE OR REPLACE VIEW v_orphan_matchable_semantic AS
    SELECT 
      o.sku_id,
      o.store_id,
      o.store_slug,
      o.external_id,
      o.declared_ean,
      o.raw_description,
      o.price_count,
      p.id as product_id,
      p.canonical_name,
      p.brand,
      p.ean as product_ean,
      'semantic' as match_method,
      -- Simple similarity score based on common words
      CASE 
        WHEN p.canonical_name ILIKE '%' || split_part(o.raw_description, ' ', 1) || '%' THEN 0.85
        ELSE 0.75
      END as match_score
    FROM v_orphan_store_sku o
    JOIN product p 
      ON p.canonical_name ILIKE '%' || split_part(o.raw_description, ' ', 1) || '%'
     AND (o.declared_ean IS NULL OR o.declared_ean NOT IN (SELECT ean FROM product WHERE ean IS NOT NULL))
    WHERE o.price_count > 0
    ORDER BY o.price_count DESC
    LIMIT 1000;
  `);

  // 4. Create a view showing truly unmatchable orphans (no EAN, no semantic match)
  await pgm.sql(`
    CREATE OR REPLACE VIEW v_orphan_unmatchable AS
    SELECT 
      o.*,
      'no_match' as match_method,
      0 as match_score
    FROM v_orphan_store_sku o
    WHERE o.sku_id NOT IN (SELECT sku_id FROM v_orphan_matchable_by_ean)
      AND o.sku_id NOT IN (SELECT sku_id FROM v_orphan_matchable_semantic)
    ORDER BY o.price_count DESC;
  `);

  // 5. Create a view showing duplicate store_sku (same store_id + external_id)
  await pgm.sql(`
    CREATE OR REPLACE VIEW v_duplicate_store_sku AS
    SELECT 
      store_id,
      external_id,
      COUNT(*) as dup_count,
      ARRAY_AGG(id ORDER BY last_seen_at DESC NULLS LAST) as sku_ids,
      ARRAY_AGG(last_seen_at ORDER BY last_seen_at DESC NULLS LAST) as seen_dates
    FROM store_sku
    WHERE is_active = true
    GROUP BY store_id, external_id
    HAVING COUNT(*) > 1
    ORDER BY dup_count DESC;
  `);

  // 6. Create a view showing price records that belong to orphaned SKUs
  await pgm.sql(`
    CREATE OR REPLACE VIEW v_orphan_prices AS
    SELECT 
      pr.*,
      ss.store_id,
      s.slug as store_slug,
      ss.external_id,
      ss.declared_ean,
      ss.raw_description
    FROM price_record pr
    JOIN store_sku ss ON ss.id = pr.store_sku_id
    JOIN store s ON s.id = ss.store_id
    LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
    WHERE ml.id IS NULL
      AND ss.is_active = true;
  `);

  // 7. Statistics summary
  await pgm.sql(`
    CREATE OR REPLACE VIEW v_orphan_cleanup_summary AS
    SELECT 
      (SELECT COUNT(*) FROM v_orphan_store_sku) as total_orphan_skus,
      (SELECT COUNT(*) FROM v_orphan_matchable_by_ean) as matchable_by_ean,
      (SELECT COUNT(*) FROM v_orphan_matchable_semantic) as matchable_semantic,
      (SELECT COUNT(*) FROM v_orphan_unmatchable) as unmatchable,
      (SELECT COUNT(*) FROM v_duplicate_store_sku) as duplicate_groups,
      (SELECT SUM(dup_count - 1) FROM v_duplicate_store_sku) as total_duplicate_skus,
      (SELECT COUNT(*) FROM v_orphan_prices) as orphan_price_records,
      (SELECT pg_size_pretty(pg_total_relation_size('price_record'))) as price_record_size,
      (SELECT pg_size_pretty(pg_total_relation_size('store_sku'))) as store_sku_size;
  `);
}

export async function down(pgm) {
  await pgm.sql(`
    DROP VIEW IF EXISTS v_orphan_cleanup_summary;
    DROP VIEW IF EXISTS v_orphan_prices;
    DROP VIEW IF EXISTS v_duplicate_store_sku;
    DROP VIEW IF EXISTS v_orphan_unmatchable;
    DROP VIEW IF EXISTS v_orphan_matchable_semantic;
    DROP VIEW IF EXISTS v_orphan_matchable_by_ean;
    DROP VIEW IF EXISTS v_orphan_store_sku;
  `);
}
