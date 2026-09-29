/**
 * DIAGNOSTIC QUERIES - Run these in Neon SQL Editor to understand the current state
 * 
 * These are READ-ONLY queries for diagnosis. Do not execute DELETE/UPDATE without review.
 */

-- ============================================================
-- 1. OVERVIEW: Current state of orphaned store_sku
-- ============================================================
SELECT 
  COUNT(*) as total_store_sku,
  COUNT(*) FILTER (WHERE product_id IS NOT NULL) as with_product,
  COUNT(*) FILTER (WHERE product_id IS NULL) as orphan_skus,
  ROUND(100.0 * COUNT(*) FILTER (WHERE product_id IS NULL) / COUNT(*), 1) as pct_orphan
FROM store_sku ss
LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
WHERE ss.is_active = true;

-- ============================================================
-- 2. PRICE RECORDS ON ORPHAN SKUs
-- ============================================================
SELECT 
  COUNT(*) as orphan_price_records,
  COUNT(DISTINCT pr.store_sku_id) as orphan_skus_with_prices,
  SUM(COUNT(*)) OVER () as total_price_records,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct_of_total
FROM price_record pr
JOIN store_sku ss ON ss.id = pr.store_sku_id
LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
WHERE ml.id IS NULL
  AND ss.is_active = true;

-- ============================================================
-- 3. ORPHAN SKUs BY STORE
-- ============================================================
SELECT 
  s.slug as store_slug,
  COUNT(DISTINCT ss.id) as orphan_skus,
  COUNT(pr.id) as price_records,
  COUNT(DISTINCT ss.declared_ean) FILTER (WHERE ss.declared_ean IS NOT NULL) as skus_with_ean
FROM store_sku ss
JOIN store s ON s.id = ss.store_id
LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
WHERE ml.id IS NULL
  AND ss.is_active = true
GROUP BY s.slug
ORDER BY orphan_skus DESC;

-- ============================================================
-- 4. ORPHAN SKUs WITH VALID EAN THAT MATCH EXISTING PRODUCTS
-- ============================================================
SELECT 
  ss.id as sku_id,
  s.slug as store,
  ss.external_id,
  ss.declared_ean,
  ss.raw_description,
  p.id as product_id,
  p.canonical_name,
  p.brand,
  COUNT(pr.id) as price_count
FROM store_sku ss
JOIN store s ON s.id = ss.store_id
JOIN product p ON p.ean = ss.declared_ean
LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
WHERE ml.id IS NULL
  AND ss.is_active = true
  AND ss.declared_ean IS NOT NULL
  AND ss.declared_ean ~ '^\d{13}$'
GROUP BY ss.id, s.slug, ss.external_id, ss.declared_ean, ss.raw_description, p.id, p.canonical_name, p.brand
ORDER BY price_count DESC
LIMIT 50;

-- ============================================================
-- 5. COUNT OF MATCHABLE BY EAN
-- ============================================================
SELECT COUNT(DISTINCT ss.id) as matchable_by_ean
FROM store_sku ss
JOIN product p ON p.ean = ss.declared_ean
LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
WHERE ml.id IS NULL
  AND ss.is_active = true
  AND ss.declared_ean IS NOT NULL
  AND ss.declared_ean ~ '^\d{13}$';

-- ============================================================
-- 6. DUPLICATE store_sku (same store_id + external_id)
-- ============================================================
SELECT 
  s.slug as store,
  ss.external_id,
  COUNT(*) as dup_count,
  ARRAY_AGG(ss.id ORDER BY ss.last_seen_at DESC NULLS LAST) as sku_ids,
  ARRAY_AGG(ss.last_seen_at ORDER BY ss.last_seen_at DESC NULLS LAST) as seen_dates,
  ARRAY_AGG(ss.declared_ean ORDER BY ss.last_seen_at DESC NULLS LAST) as eans
FROM store_sku ss
JOIN store s ON s.id = ss.store_id
WHERE ss.is_active = true
GROUP BY s.slug, ss.external_id
HAVING COUNT(*) > 1
ORDER BY dup_count DESC
LIMIT 50;

-- ============================================================
-- 7. TOTAL DUPLICATE COUNT
-- ============================================================
SELECT 
  COUNT(*) as duplicate_groups,
  SUM(cnt - 1) as excess_skus
FROM (
  SELECT COUNT(*) as cnt
  FROM store_sku
  WHERE is_active = true
  GROUP BY store_id, external_id
  HAVING COUNT(*) > 1
) d;

-- ============================================================
-- 8. ORPHAN SKUs WITHOUT EAN - CAN THEY MATCH SEMANTICALLY?
-- ============================================================
-- Sample of orphan SKUs without EAN that might match by name
SELECT 
  ss.id as sku_id,
  s.slug as store,
  ss.external_id,
  ss.raw_description,
  COUNT(pr.id) as price_count
FROM store_sku ss
JOIN store s ON s.id = ss.store_id
LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
WHERE ml.id IS NULL
  AND ss.is_active = true
  AND ss.declared_ean IS NULL
GROUP BY ss.id, s.slug, ss.external_id, ss.raw_description
ORDER BY price_count DESC
LIMIT 30;

-- ============================================================
-- 9. STORAGE USAGE
-- ============================================================
SELECT 
  'price_record' as table_name,
  pg_size_pretty(pg_total_relation_size('price_record')) as total_size,
  pg_size_pretty(pg_relation_size('price_record')) as table_size,
  pg_size_pretty(pg_total_relation_size('price_record') - pg_relation_size('price_record')) as index_size
UNION ALL
SELECT 
  'store_sku',
  pg_size_pretty(pg_total_relation_size('store_sku')),
  pg_size_pretty(pg_relation_size('store_sku')),
  pg_size_pretty(pg_total_relation_size('store_sku') - pg_relation_size('store_sku'))
UNION ALL
SELECT 
  'product',
  pg_size_pretty(pg_total_relation_size('product')),
  pg_size_pretty(pg_relation_size('product')),
  pg_size_pretty(pg_total_relation_size('product') - pg_relation_size('product'))
UNION ALL
SELECT 
  'match_link',
  pg_size_pretty(pg_total_relation_size('match_link')),
  pg_size_pretty(pg_relation_size('match_link')),
  pg_size_pretty(pg_total_relation_size('match_link') - pg_relation_size('match_link'));

-- ============================================================
-- 10. POTENTIAL CLEANUP IMPACT ESTIMATE
-- ============================================================
WITH stats AS (
  SELECT 
    COUNT(DISTINCT ss.id) as orphan_skus,
    COUNT(pr.id) as orphan_prices,
    COUNT(DISTINCT ss.id) FILTER (WHERE ss.declared_ean IS NOT NULL AND ss.declared_ean ~ '^\d{13}$') as skus_with_valid_ean,
    COUNT(DISTINCT ss.id) FILTER (WHERE ss.declared_ean IS NOT NULL AND ss.declared_ean ~ '^\d{13}$' AND EXISTS (SELECT 1 FROM product p WHERE p.ean = ss.declared_ean)) as matchable_by_ean
  FROM store_sku ss
  LEFT JOIN price_record pr ON pr.store_sku_id = ss.id
  LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
  WHERE ml.id IS NULL
    AND ss.is_active = true
)
SELECT 
  orphan_skus,
  orphan_prices,
  skus_with_valid_ean,
  matchable_by_ean,
  orphan_skus - matchable_by_ean as remaining_after_ean_match,
  ROUND(100.0 * matchable_by_ean / orphan_skus, 1) as pct_recoverable_by_ean
FROM stats;

-- ============================================================
-- SAFE CLEANUP COMMANDS (REVIEW BEFORE EXECUTING)
-- ============================================================

/*
-- STEP 1: Associate orphan SKUs with existing products by EAN (SAFE - exact match)
INSERT INTO match_link (store_sku_id, product_id, method, score, status)
SELECT ss.id, p.id, 'ean', 1.0, 'auto'
FROM store_sku ss
JOIN product p ON p.ean = ss.declared_ean
LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
WHERE ml.id IS NULL
  AND ss.is_active = true
  AND ss.declared_ean IS NOT NULL
  AND ss.declared_ean ~ '^\d{13}$'
ON CONFLICT (store_sku_id) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  method = EXCLUDED.method,
  score = EXCLUDED.score,
  status = EXCLUDED.status;

-- STEP 2: Update declared_ean on store_sku from matched product (if missing)
UPDATE store_sku ss
SET declared_ean = p.ean
FROM match_link ml
JOIN product p ON p.id = ml.product_id
WHERE ml.store_sku_id = ss.id
  AND ss.declared_ean IS NULL
  AND p.ean IS NOT NULL;

-- STEP 3: Deactivate duplicate store_sku (keep most recent)
WITH ranked AS (
  SELECT id, 
         ROW_NUMBER() OVER (PARTITION BY store_id, external_id ORDER BY last_seen_at DESC NULLS LAST) as rn
  FROM store_sku
  WHERE is_active = true
)
UPDATE store_sku
SET is_active = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- STEP 4: Move prices from deactivated SKUs to the kept one
UPDATE price_record pr
SET store_sku_id = kept.id
FROM (
  SELECT store_id, external_id, 
         FIRST_VALUE(id) OVER (PARTITION BY store_id, external_id ORDER BY last_seen_at DESC NULLS LAST) as kept_id
  FROM store_sku
  WHERE is_active = true
) kept
JOIN store_sku old ON old.store_id = kept.store_id AND old.external_id = kept.external_id
WHERE pr.store_sku_id = old.id
  AND old.id != kept.kept_id;

-- STEP 5: Move match_links from deactivated SKUs to the kept one
UPDATE match_link ml
SET store_sku_id = kept.id
FROM (
  SELECT store_id, external_id, 
         FIRST_VALUE(id) OVER (PARTITION BY store_id, external_id ORDER BY last_seen_at DESC NULLS LAST) as kept_id
  FROM store_sku
  WHERE is_active = true
) kept
JOIN store_sku old ON old.store_id = kept.store_id AND old.external_id = kept.external_id
WHERE ml.store_sku_id = old.id
  AND old.id != kept.kept_id;
*/

-- ============================================================
-- VERIFICATION QUERIES AFTER CLEANUP
-- ============================================================

/*
-- Verify orphan reduction
SELECT 
  COUNT(*) as total_store_sku,
  COUNT(*) FILTER (WHERE product_id IS NOT NULL) as with_product,
  COUNT(*) FILTER (WHERE product_id IS NULL) as orphan_skus
FROM store_sku ss
LEFT JOIN match_link ml ON ml.store_sku_id = ss.id
WHERE ss.is_active = true;

-- Verify no duplicate active SKUs
SELECT COUNT(*) as duplicate_active
FROM store_sku
WHERE is_active = true
GROUP BY store_id, external_id
HAVING COUNT(*) > 1;

-- Verify price records still point to valid SKUs
SELECT COUNT(*) as orphaned_prices
FROM price_record pr
LEFT JOIN store_sku ss ON ss.id = pr.store_sku_id
WHERE ss.id IS NULL OR ss.is_active = false;
*/