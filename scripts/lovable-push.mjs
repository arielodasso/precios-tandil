/**
 * Empuja un snapshot diario de precios desde Neon al sitio de Lovable.
 *
 * Neon (DATABASE_URL) -> POST {LOVABLE_INGEST_URL}/api/ingest -> Lovable Cloud
 * (upsert vía service_role con el secreto INGEST_SECRET).
 *
 * La ingesta de Playwright y el `finalize` siguen corriendo en GitHub Actions;
 * este paso sólo replica lo publicable en el sitio de Lovable.
 *
 * Variables:
 *   DATABASE_URL        conexión a Neon (lectura).
 *   LOVABLE_INGEST_URL  base del sitio, p. ej. https://preciostandil.lovable.app
 *   INGEST_SECRET       secreto compartido con el secreto INGEST_SECRET de Lovable.
 *   HISTORY_DAYS        días de historial a enviar (default 7).
 *   HISTORY_FULL        si es "1", envía todo el historial.
 */
import pg from 'pg';

const { DATABASE_URL, LOVABLE_INGEST_URL, INGEST_SECRET } = process.env;
if (!DATABASE_URL) throw new Error('falta DATABASE_URL');
if (!LOVABLE_INGEST_URL) throw new Error('falta LOVABLE_INGEST_URL');
if (!INGEST_SECRET) throw new Error('falta INGEST_SECRET');

const HISTORY_FULL = process.env.HISTORY_FULL === '1';
const HISTORY_DAYS = Number.parseInt(process.env.HISTORY_DAYS ?? '7', 10);
const CHUNK = 500;
const ENDPOINT = `${LOVABLE_INGEST_URL.replace(/\/$/, '')}/api/ingest`;

const CBA_ITEMS = [
  ['cereales-pan', 'Pan lactal', 'Cereales', /^pan lactal/],
  ['cereales-galletitas-agua', 'Galletitas de agua', 'Cereales', /^galletitas agua/],
  ['cereales-galletitas-dulces', 'Galletitas dulces', 'Cereales', /^galletas? dulces?/],
  ['cereales-arroz', 'Arroz', 'Cereales', /^arroz (molinos ala|parboil|largo fino)/],
  ['cereales-harina', 'Harina de trigo', 'Cereales', /^harina (trigo|0000)/],
  ['cereales-fideos', 'Fideos', 'Cereales', /^fideos /],
  ['carnes-asado', 'Asado', 'Carnes y huevos', /^asado$/],
  ['carnes-atun', 'Atún', 'Carnes y huevos', /^atun /],
  ['carnes-huevos', 'Huevos', 'Carnes y huevos', /^huevos blancos/],
  ['lacteos-queso', 'Queso', 'Lácteos', /^queso /],
  ['lacteos-yogur', 'Yogur', 'Lácteos', /^yogur /],
  ['lacteos-manteca', 'Manteca', 'Lácteos', /^manteca( tonadita)?$/],
  [
    'lacteos-leche',
    'Leche',
    'Lácteos',
    /^leche (entera|descremada|parcialmente descremada|uat|en polvo)/,
  ],
  ['verduras-tomate', 'Tomate envasado', 'Verduras y legumbres', /^tomate perita/],
  ['verduras-cebolla', 'Cebolla deshidratada', 'Verduras y legumbres', /^cebolla deshidratada/],
  ['verduras-lentejas', 'Lentejas', 'Verduras y legumbres', /^lentejas /],
  ['verduras-arvejas', 'Arvejas', 'Verduras y legumbres', /^arvejas /],
  [
    'azucares-azucar',
    'Azúcar',
    'Azúcares y dulces',
    /^azucar (tradicional|premium|domino|superior)/,
  ],
  ['azucares-dulce-leche', 'Dulce de leche', 'Azúcares y dulces', /^dulce leche /],
  ['azucares-mermelada', 'Mermelada', 'Azúcares y dulces', /^mermelada /],
  ['azucares-dulce-batata', 'Dulce de batata', 'Azúcares y dulces', /^dulce batata arcor$/],
  ['otros-aceite', 'Aceite de girasol', 'Otros', /^aceite girasol /],
  ['otros-sal', 'Sal fina', 'Otros', /^sal fina /],
  ['otros-agua', 'Agua mineral', 'Otros', /^agua mineral /],
];

const dayStr = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const isoStr = (v) => (v instanceof Date ? v.toISOString() : (v ?? null));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function push(table, mode, rows) {
  if (!rows.length) {
    console.log(`  ${table}: 0 filas (skip)`);
    return;
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const body = JSON.stringify({ table, mode, rows: slice });
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${INGEST_SECRET}`,
          },
          body,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} ${text.slice(0, 300)}`);
        }
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < 3) await sleep(attempt * 2000);
      }
    }
    if (lastError) throw new Error(`push ${table} (fila ${i}): ${lastError.message}`);
  }
  console.log(`  ${table}: ${rows.length} filas (${mode})`);
}

const { Client } = pg;
const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const sel = async (sql) => (await c.query(sql)).rows;

const stores = await sel('select id, slug, name, base_url, is_active from store order by id');
const cats = await sel('select id, slug, name, parent_id, path from category order by path');
const prods = await sel(
  `select id, slug, canonical_name, brand, ean, unit_amount, unit_type, image_url, category_id, created_at
   from product order by id`,
);
const offers = await sel(`
  select distinct on (ml.product_id, ss.store_id)
         ml.product_id, ss.store_id, pr.price_amount, pr.source_url, pr.captured_at
  from price_record pr
  join store_sku ss on ss.id = pr.store_sku_id
  join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto','confirmed')
  join store s on s.id = ss.store_id and s.is_active
  where pr.is_suspect = false
  order by ml.product_id, ss.store_id, pr.captured_at desc,
           case when pr.list_or_promo = 'promo' then 0 else 1 end, pr.price_amount asc`);

const histFilter = HISTORY_FULL ? '' : `where day >= current_date - ${HISTORY_DAYS}`;
const hist = await sel(
  `select product_id, day, min_price, avg_price from daily_series ${histFilter} order by product_id, day`,
);
const histRef = await sel(
  `select product_id, avg(min_price) as ref_price, count(*) as n
   from daily_series where day >= current_date - 30 group by product_id having count(*) >= 5`,
);
const cand = await sel(
  `select p.id product_id, p.canonical_name, pa.stores_count, pa.best_price
   from product p join price_aggregate pa on pa.product_id = p.id`,
);
await c.end();

const catSort = new Map();
{
  const byParent = new Map();
  for (const cc of cats) {
    const k = cc.parent_id ?? 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(cc);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    arr.forEach((cc, i) => catSort.set(cc.id, i + 1));
  }
}

const cba = [];
let sort = 0;
for (const [key, label, rubric, re] of CBA_ITEMS) {
  const pool = cand
    .filter((x) => re.test(x.canonical_name))
    .sort(
      (a, b) =>
        b.stores_count - a.stores_count ||
        Number(a.best_price) - Number(b.best_price) ||
        a.canonical_name.length - b.canonical_name.length,
    );
  if (!pool.length) continue;
  sort += 1;
  cba.push({ key, label, rubric, product_id: Number(pool[0].product_id), sort });
}

const round2 = (n) => Math.round(n * 100) / 100;
const bestBy = new Map();
for (const o of offers) {
  const price = Number(o.price_amount);
  if (!(price >= 500)) continue;
  const cur = bestBy.get(o.product_id);
  if (!cur || price < cur.price) bestBy.set(o.product_id, { price, store_id: o.store_id });
}
const deals = [];
for (const r of histRef) {
  const ref = Number(r.ref_price);
  const best = bestBy.get(r.product_id);
  if (!best || !(ref > 0)) continue;
  const discount = round2(((ref - best.price) / ref) * 100);
  if (!(best.price < ref * 0.9) || discount > 60) continue;
  deals.push({ product_id: r.product_id, store_id: best.store_id, discount_pct: discount });
}
deals.sort((a, b) => b.discount_pct - a.discount_pct);
const topDeals = deals.slice(0, 120);
const now = Date.now();
const dealsRows = topDeals.map((d) => ({
  product_id: Number(d.product_id),
  store_id: d.store_id,
  discount_pct: d.discount_pct,
  badge: d.discount_pct >= 20 ? 'Mejor Oportunidad de la Semana' : 'Precio bajó',
  status: 'published',
  published_at: new Date(now).toISOString(),
  expires_at: new Date(now + 7 * 864e5).toISOString(),
}));

console.log(`Push a ${ENDPOINT}`);
console.log(
  `  stores=${stores.length} categorias=${cats.length} productos=${prods.length} ` +
    `ofertas=${offers.length} historial=${hist.length} deals=${dealsRows.length} cba=${cba.length}`,
);

await push(
  'stores',
  'upsert',
  stores.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    base_url: s.base_url,
    is_active: s.is_active,
  })),
);
await push(
  'categories',
  'upsert',
  cats.map((cc) => ({
    id: cc.id,
    slug: cc.slug,
    name: cc.name,
    parent_id: cc.parent_id,
    sort: catSort.get(cc.id) ?? 0,
  })),
);
await push(
  'products',
  'upsert',
  prods.map((p) => ({
    id: p.id,
    slug: p.slug,
    canonical_name: p.canonical_name,
    brand: p.brand,
    ean: p.ean,
    unit_amount: p.unit_amount,
    unit_type: p.unit_type,
    image_url: p.image_url,
    category_id: p.category_id,
    created_at: isoStr(p.created_at),
  })),
);
await push('cba_items', 'upsert', cba);
await push(
  'offers',
  'upsert',
  offers.map((o) => ({
    product_id: o.product_id,
    store_id: o.store_id,
    price: Number(o.price_amount),
    source_url: o.source_url,
    captured_at: isoStr(o.captured_at),
  })),
);
await push(
  'price_history',
  'upsert',
  hist.map((h) => ({
    product_id: h.product_id,
    day: dayStr(h.day),
    min_price: Number(h.min_price),
    avg_price: h.avg_price == null ? null : Number(h.avg_price),
  })),
);
await push('deals', 'replace', dealsRows);

console.log('Listo.');
