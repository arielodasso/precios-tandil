/**
 * Detecta links a presentaciones distintas dentro de un mismo producto:
 * cuando un producto tiene enlazados SKUs cuya presentación (peso/volumen) no
 * coincide con la canónica del producto ("500 g" junto a "1 kg", "475 g" junto
 * a "250 g"), esos links son sospechosos y quedan en `pending_review` para que
 * el matcher/admin los re-encamine o rechace. Dejan de aparecer en la web
 * (solo se muestran links auto/confirmed), eliminando enlaces que llevan a un
 * producto de otra marca o peso.
 *
 * Uso:
 *   pnpm --filter @precios/worker unconflict          # dry-run (reporta)
 *   pnpm --filter @precios/worker unconflict --apply  # demueve los links
 */
import { loadConfig } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { logger } from './lib/logger.ts';
import { normalizeDescription } from '@precios/normalizer';

const APPLY = process.argv.includes('--apply');
const TOLERANCE = 0.95;

type UnitScale = 'weight' | 'volume';

function scale(unitType: string | null): UnitScale | null {
  if (unitType === 'kg' || unitType === 'g') return 'weight';
  if (unitType === 'l' || unitType === 'ml') return 'volume';
  return null;
}

function toBase(unitType: string, amount: number): number | null {
  if (unitType === 'kg') return amount * 1000;
  if (unitType === 'g') return amount;
  if (unitType === 'l') return amount * 1000;
  if (unitType === 'ml') return amount;
  return null;
}

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

interface LinkRow {
  id: number;
  product_id: number;
  store_id: number;
  declared_ean: string | null;
  raw_description: string;
  description: string | null;
}

async function run() {
  const products = (await db
    .selectFrom('product')
    .select(['id', 'ean', 'canonical_name', 'unit_amount', 'unit_type'])
    .execute()) as unknown as Array<{
    id: number;
    ean: string | null;
    canonical_name: string;
    unit_amount: string | null;
    unit_type: string | null;
  }>;

  const links = (await db
    .selectFrom('match_link as ml')
    .innerJoin('store_sku as ss', 'ss.id', 'ml.store_sku_id')
    .select([
      'ml.id',
      'ml.product_id',
      'ss.store_id',
      'ss.declared_ean',
      'ss.raw_description',
      'ss.description',
    ])
    .where('ml.status', 'in', ['auto', 'confirmed'])
    .execute()) as unknown as LinkRow[];

  logger.info(
    { dryRun: !APPLY, products: products.length, links: links.length },
    'unconflict: analizando tamaño de presentación por producto',
  );

  const byProduct = new Map<number, LinkRow[]>();
  for (const l of links) {
    const arr = byProduct.get(l.product_id) ?? [];
    arr.push(l);
    byProduct.set(l.product_id, arr);
  }

  const demote = new Set<number>();
  const reasons = new Map<number, string>();

  let productsWithRef = 0;
  for (const p of products) {
    const group = byProduct.get(p.id);
    if (!group || group.length < 2) continue;

    let refBase: { base: number; unit: string | null } | null = null;
    if (p.unit_amount !== null && p.unit_type !== null && scale(p.unit_type)) {
      const base = toBase(p.unit_type, Number(p.unit_amount));
      if (base !== null) refBase = { base, unit: p.unit_type };
    }

    if (!refBase) {
      const sizes = new Map<number, number>();
      for (const l of group) {
        const s = sizeOf(l);
        if (s) sizes.set(s.base, (sizes.get(s.base) ?? 0) + 1);
      }
      if (sizes.size === 1) continue;
      const mode = [...sizes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
      if (!mode) continue;
      refBase = { base: mode[0], unit: null };
    }

    productsWithRef++;
    for (const l of group) {
      if (l.declared_ean && p.ean && l.declared_ean === p.ean) continue;
      const s = sizeOf(l);
      if (!s) continue;
      if (
        refBase.unit !== null &&
        scale(refBase.unit) !== null &&
        s.scale !== scale(refBase.unit)
      ) {
        demote.add(l.id);
        reasons.set(l.id, `escala distinta (sku ${s.scale ?? '?'}, ref ${refBase.unit})`);
        continue;
      }
      const ratio = Math.min(s.base, refBase.base) / Math.max(s.base, refBase.base);
      if (ratio < TOLERANCE) {
        demote.add(l.id);
        reasons.set(
          l.id,
          `presentación distinta (sku ${s.base}${s.unit}, ref ${refBase.base}${refBase.unit ?? ''})`,
        );
      }
    }
  }

  logger.info(
    { dryRun: !APPLY, productsChecked: productsWithRef, linksToDemote: demote.size },
    'unconflict: links a presentaciones distintas detectados',
  );

  const samples: Array<Record<string, string>> = [];
  for (const id of demote) {
    if (samples.length >= 20) break;
    const link = links.find((l) => l.id === id);
    if (!link) continue;
    const p = products.find((x) => x.id === link.product_id);
    samples.push({
      linkId: String(id),
      producto: (p?.canonical_name ?? '').slice(0, 46),
      motivo: reasons.get(id) ?? '',
      sku: (link.raw_description || '').slice(0, 44),
    });
  }
  if (samples.length > 0) console.table(samples);

  if (!APPLY) {
    logger.info(
      'unconflict: dry-run, no se aplicaron cambios. Usá --apply para demover los links.',
    );
    return;
  }

  if (demote.size > 0) {
    const ids = [...demote];
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      await db
        .updateTable('match_link')
        .set({ status: 'pending_review', decided_by: 'unconflict-cli', decided_at: new Date() })
        .where('id', 'in', batch)
        .execute();
    }
    logger.info({ demoted: demote.size }, 'unconflict: links pasados a pending_review');
  }
}

function sizeOf(l: LinkRow): { base: number; unit: string; scale: UnitScale | null } | null {
  const raw = l.raw_description || '';
  const norm = normalizeDescription(raw, { description: l.description ?? undefined });
  if (norm.unitType === null || norm.unitAmount === null) return null;
  const sc = scale(norm.unitType);
  const base = toBase(norm.unitType, norm.unitAmount);
  if (base === null) return null;
  return { base, unit: norm.unitType, scale: sc };
}

run()
  .catch((err) => {
    logger.error({ err }, 'unconflict falló');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
