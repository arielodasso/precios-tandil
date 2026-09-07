/**
 * Matcheo puntual de SKUs sin vínculo (status null) o en revisión pendiente.
 *
 * Los SKUs activos de una tienda sin `match_link` (status null) nunca entraron
 * a la fase de matching. Este CLI aplica la MISMA lógica del pipeline
 * (findBestMatch con autoThreshold 0.82) sobre los productos existentes.
 *
 * Modos:
 *   (por defecto)  Solo vincula SKUs con un match claro (>= umbral).
 *   --create       Además, para SKUs sin match, crea un producto nuevo a partir
 *                  de su descripción normalizada (igual que hace el bulk-import
 *                  y el pipeline) y lo vincula. Así ningún SKU queda "huérfano"
 *                  y los precios de todas las fuentes quedan visibles.
 *
 * Uso: pnpm --filter @precios/worker match-missing [--store=slug] [--create]
 *                        # dry-run (no escribe)
 *      ... -- --apply    # escribe cambios
 */
import { createHash } from 'node:crypto';
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { sql } from 'kysely';
import {
  normalizeDescription,
  findBestMatch,
  type MatchCandidate,
  type NormalizedProduct,
} from '@precios/normalizer';
import { matchCategoryByName } from './lib/category-map.ts';

const APPLY = process.argv.includes('--apply');
const CREATE = process.argv.includes('--create');
const AUTO_MATCH_THRESHOLD = 0.82;
const FLUSH_EVERY = 300;

const storeArg = process.argv.find((a) => a.startsWith('--store='));
const STORE_SLUG = storeArg ? storeArg.split('=')[1] : null;

interface ProductRow {
  id: number;
  slug: string;
  ean: string | null;
  canonical_name: string;
  brand: string | null;
  unit_amount: string | null;
  unit_type: string | null;
  image_url: string | null;
  image_hash: string | null;
}

interface SkuRow {
  id: number;
  raw_description: string;
  description: string | null;
  declared_ean: string | null;
  store_slug: string;
  link_status: string | null;
}

function normalizeEan(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  if (!/^\d{8,}$/.test(s)) return null;
  return s;
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
    brandProvided: norm.brandProvided,
    typeKeys: norm.typeKeys,
    variantFlags: norm.variantFlags,
    imageHash: p.image_hash,
    imageUrl: p.image_url,
    contextText: '',
  };
}

function forgeSlug(norm: NormalizedProduct, ean: string | null, name: string): string {
  const slugBase = norm.normName.replace(/\s+/g, '-').slice(0, 60) || 'producto';
  const hash = createHash('sha1').update(ean ?? name).digest('base64url').slice(0, 6);
  return `${slugBase}-${hash}`;
}

interface MatchResult {
  productId: number;
  method: 'ean' | 'semantic';
  score: number;
}

function tokensOf(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length >= 3);
}

function matchSku(
  norm: ReturnType<typeof normalizeDescription>,
  declaredEan: string | null | undefined,
  candidates: MatchCandidate[],
  eanMap: Map<string, MatchCandidate[]>,
  tokenIndex: Map<string, number[]>,
): MatchResult | null {
  const ean = normalizeEan(declaredEan ?? null);
  if (ean) {
    const hits = eanMap.get(ean) ?? [];
    if (hits.length === 1) {
      return { productId: hits[0]!.productId, method: 'ean', score: 1 };
    }
    if (hits.length > 1) {
      let best: MatchCandidate | null = null;
      let bestScore = -1;
      for (const cand of hits) {
        const s = findBestMatch(norm, ean, [cand], { autoThreshold: AUTO_MATCH_THRESHOLD });
        if (s.method === 'none') continue;
        if (s.score > bestScore) {
          bestScore = s.score;
          best = cand;
        }
      }
      if (best) return { productId: best.productId, method: 'ean', score: 1 };
    }
  }
  const subset: MatchCandidate[] = [];
  const seen = new Set<number>();
  for (const token of tokensOf(norm.normName)) {
    const idxs = tokenIndex.get(token);
    if (!idxs) continue;
    for (const idx of idxs) {
      if (!seen.has(idx)) {
        seen.add(idx);
        subset.push(candidates[idx]!);
      }
    }
  }
  if (subset.length === 0) return null;
  const outcome = findBestMatch(norm, ean ?? undefined, subset, {
    autoThreshold: AUTO_MATCH_THRESHOLD,
  });
  if (outcome.method === 'ean' || outcome.method === 'semantic') {
    return { productId: outcome.productId, method: outcome.method, score: outcome.score };
  }
  return null;
}

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

async function main() {
  const products = (await db
    .selectFrom('product')
    .select([
      'id',
      'slug',
      'ean',
      'canonical_name',
      'brand',
      'unit_amount',
      'unit_type',
      'image_url',
      'image_hash',
    ])
    .execute()) as unknown as ProductRow[];

  const candidates: MatchCandidate[] = products.map(toCandidate);
  const slugToId = new Map<string, number>(products.map((p) => [p.slug, Number(p.id)]));

  const eanMap = new Map<string, MatchCandidate[]>();
  const tokenIndex = new Map<string, number[]>();
  const indexCandidate = (c: MatchCandidate, idx: number) => {
    const ean = normalizeEan(c.ean);
    if (ean) {
      const list = eanMap.get(ean);
      if (list) list.push(c);
      else eanMap.set(ean, [c]);
    }
    for (const token of tokensOf(c.normName)) {
      const list = tokenIndex.get(token);
      if (list) list.push(idx);
      else if (token.length >= 3) tokenIndex.set(token, [idx]);
    }
  };
  for (let i = 0; i < candidates.length; i++) indexCandidate(candidates[i]!, i);

  const rows = await sql<SkuRow & { store_slug: string; link_status: string | null }>`
    select ss.id, ss.raw_description, ss.description, ss.declared_ean,
           s.slug as store_slug, ml.status as link_status
    from store_sku ss
    join store s on s.id = ss.store_id
    left join match_link ml on ml.store_sku_id = ss.id
    where ss.is_active and s.is_active
      and (ml.status is null or ml.status in ('pending_review', 'rejected'))
      ${STORE_SLUG ? sql`and s.slug = ${STORE_SLUG}` : sql``}
  `
    .execute(db)
    .then((r) => r.rows);

  const stats = {
    total: rows.length,
    matchEan: 0,
    matchSemantic: 0,
    noMatch: 0,
    createdProducts: 0,
  };

  const pendingProducts: Array<{
    slug: string;
    canonical_name: string;
    brand: string | null;
    ean: string | null;
    unit_amount: string | null;
    unit_type: 'kg' | 'g' | 'l' | 'ml' | 'un' | null;
    image_url: string | null;
    category_id: number | null;
  }> = [];
  const pendingLinks: Array<{
    store_sku_id: number;
    product_id: number | null;
    slug?: string;
    method: 'ean' | 'semantic';
    score: string;
    status: 'auto';
  }> = [];

  async function flush() {
    if (!APPLY) return;
    if (pendingProducts.length > 0) {
      const unique = new Map<string, (typeof pendingProducts)[number]>();
      for (const p of pendingProducts) {
        if (!unique.has(p.slug)) unique.set(p.slug, p);
      }
      const ins = await db
        .insertInto('product')
        .values([...unique.values()])
        .onConflict((oc) => oc.column('slug').doUpdateSet({ updated_at: new Date() }))
        .returning(['id', 'slug'])
        .execute();
      for (const r of ins) {
        const id = Number(r.id);
        slugToId.set(r.slug as string, id);
        const prod = unique.get(r.slug as string);
        if (prod && id > 0) {
          // Resolver links que esperaban la slug recién creada
          for (const link of pendingLinks) {
            if (link.slug === (r.slug as string)) link.product_id = id;
          }
          const norm = normalizeDescription(prod.canonical_name, { brand: prod.brand });
          const cand: MatchCandidate = {
            productId: id,
            ean: prod.ean,
            normName: norm.normName,
            unitAmount: prod.unit_amount !== null ? Number(prod.unit_amount) : null,
            unitType: prod.unit_type,
            brand: prod.brand,
            brandProvided: norm.brandProvided,
            typeKeys: norm.typeKeys,
            variantFlags: norm.variantFlags,
            imageHash: null,
            imageUrl: prod.image_url,
            contextText: '',
          };
          candidates.push(cand);
          indexCandidate(cand, candidates.length - 1);
        }
      }
      pendingProducts.length = 0;
    }
    const ready = pendingLinks
      .filter((l) => l.product_id !== null && l.product_id !== undefined)
      .map((l) => ({
        store_sku_id: l.store_sku_id,
        product_id: l.product_id as number,
        method: l.method,
        score: l.score,
        status: l.status,
      }));
    // Los links que aún no tienen product_id (no se creó la slug) se descartan.
    pendingLinks.length = 0;
    if (ready.length > 0) {
      await db
        .insertInto('match_link')
        .values(ready)
        .onConflict((oc) =>
          oc.column('store_sku_id').doUpdateSet({
            product_id: sql.ref('excluded.product_id'),
            method: sql.ref('excluded.method'),
            score: sql.ref('excluded.score'),
            status: sql.ref('excluded.status'),
          }),
        )
        .execute();
    }
  }

  const categories = await db.selectFrom('category').select(['id', 'path']).execute();
  const pathToCatId = new Map<string, number>(
    categories.map((c) => [c.path, Number(c.id)]),
  );
  const categoryIdFor = (name: string): number | null => {
    const path = matchCategoryByName(name);
    return path ? pathToCatId.get(path) ?? null : null;
  };

  let processed = 0;
  for (const sku of rows) {
    processed++;
    if (processed % 1000 === 0) {
      logger.info({ processed, total: stats.total }, 'progreso match-missing');
    }
    const norm = normalizeDescription(sku.raw_description, { description: sku.description });
    let outcome = matchSku(norm, sku.declared_ean, candidates, eanMap, tokenIndex);
    let pendingSlug: string | null = null;

    if (!outcome && CREATE) {
      const realEan =
        sku.declared_ean && /^\d{13}$/.test(sku.declared_ean.trim())
          ? sku.declared_ean.trim()
          : null;
      const slug = forgeSlug(norm, realEan, sku.raw_description);
      const existing = slugToId.get(slug);
      if (existing !== undefined) {
        outcome = { productId: existing, method: 'semantic', score: 0.82 };
      } else {
        pendingProducts.push({
          slug,
          canonical_name: norm.normName,
          brand: norm.brand ?? null,
          ean: realEan,
          unit_amount: norm.unitAmount !== null ? String(norm.unitAmount) : null,
          unit_type: norm.unitType,
          image_url: null,
          category_id: categoryIdFor(norm.normName),
        });
        pendingSlug = slug;
        outcome = { productId: -1, method: 'semantic', score: 0.82 };
      }
    }

    if (outcome) {
      const fn = outcome.method === 'ean' ? 'matchEan' : 'matchSemantic';
      stats[fn]++;
      if (pendingSlug) {
        stats.createdProducts++;
        pendingLinks.push({
          store_sku_id: sku.id,
          product_id: null,
          slug: pendingSlug,
          method: 'semantic',
          score: '0.8200',
          status: 'auto',
        });
      } else {
        pendingLinks.push({
          store_sku_id: sku.id,
          product_id: outcome.productId,
          method: outcome.method,
          score: outcome.method === 'ean' ? '1.0000' : outcome.score.toFixed(4),
          status: 'auto',
        });
      }
    } else {
      stats.noMatch++;
    }

    if (processed % FLUSH_EVERY === 0) await flush();
  }

  await flush();

  logger.info(
    { dryRun: !APPLY, create: CREATE, ...stats },
    'match-missing: resumen',
  );
  await db.destroy();
}

main()
  .catch((err) => {
    logger.error({ err }, 'match-missing falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());