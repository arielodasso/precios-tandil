import { loadConfig } from '../src/lib/config.ts';
import { createDb } from '../src/lib/db.ts';

const db = createDb(loadConfig().DATABASE_URL);

const products = (await db
  .selectFrom('product')
  .select(['id', 'ean', 'canonical_name', 'brand', 'unit_amount', 'unit_type', 'image_url', 'image_hash', 'updated_at', 'created_at'])
  .execute()) as unknown as Array<{
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
}>;

const candidates = new Map(products.map((p) => [p.id, p] as const));
console.log('products:', products.length);

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
  .execute()) as unknown as Array<Record<string, unknown>>;

console.log('pending:', pending.length);
let missing = 0;
const exampleKeys = Object.keys(pending[0] ?? {});
console.log('pending row keys:', exampleKeys);
for (const link of pending) {
  const pid = Number(link.product_id);
  if (!candidates.has(pid)) {
    missing++;
    if (missing <= 5) console.log('  MISSING product_id:', pid, JSON.stringify(link.product_id), typeof link.product_id);
  }
}
console.log('missing:', missing);

const harina = pending.filter((l) => String(l.raw_description ?? '').includes('HARINA'));
console.log('harina-ish pending links:', harina.length, JSON.stringify(harina.map((h) => ({ linkId: h.id, product_id: h.product_id, raw: h.raw_description }))));

await db.destroy();