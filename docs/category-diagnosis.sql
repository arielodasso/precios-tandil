-- Run this in Neon SQL Editor to diagnose the category issue:

-- 1. Check how many products have category_id = null
SELECT 
  COUNT(*) as total_products,
  COUNT(*) FILTER (WHERE category_id IS NULL) as products_without_category,
  COUNT(*) FILTER (WHERE category_id IS NOT NULL) as products_with_category,
  ROUND(100.0 * COUNT(*) FILTER (WHERE category_id IS NULL) / COUNT(*), 1) as pct_without_category
FROM product;

-- 2. Check price records linked to products without category
SELECT 
  COUNT(pr.id) as price_records_on_uncategorized_products,
  COUNT(DISTINCT p.id) as uncategorized_products_with_prices
FROM price_record pr
JOIN store_sku ss ON ss.id = pr.store_sku_id
JOIN match_link ml ON ml.store_sku_id = ss.id
JOIN product p ON p.id = ml.product_id
WHERE p.category_id IS NULL
  AND ml.status IN ('auto', 'confirmed');

-- 3. Category distribution (direct counts)
SELECT 
  c.path,
  c.name,
  COUNT(p.id) as direct_product_count
FROM category c
LEFT JOIN product p ON p.category_id = c.id
GROUP BY c.id, c.path, c.name
ORDER BY direct_product_count DESC;

-- 4. Check if categories exist in DB
SELECT path, slug, name FROM category ORDER BY path;

-- 5. Check pipeline category resolution - products created via dropped links (bug at pipeline.ts:365)
SELECT 
  p.id,
  p.slug,
  p.canonical_name,
  p.category_id,
  c.path as category_path
FROM product p
LEFT JOIN category c ON c.id = p.category_id
WHERE p.category_id IS NULL
ORDER BY p.created_at DESC
LIMIT 50;