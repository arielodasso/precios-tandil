import pg from 'pg';
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node _gen_lovable_seed.mjs <out.sql>');

const { Client } = pg;
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const sel = async (sql) => (await c.query(sql)).rows;

const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const row = (cols) => `(${cols.map(lit).join(',')})`;

function stmt(table, cols, rows, chunk = 500) {
  const parts = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    parts.push(
      `insert into public.${table} (${cols.join(',')}) values\n` +
        slice.map((r) => '  ' + row(r)).join(',\n') +
        ';',
    );
  }
  return parts.join('\n');
}

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

const stores = await sel(`select id, slug, name, base_url, is_active from store order by id`);
const cats = await sel(`select id, slug, name, parent_id, path from category order by path`);
const prods = await sel(
  `select id, slug, canonical_name, brand, ean, unit_amount, unit_type, image_url, category_id, created_at from product order by id`,
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
const hist = await sel(
  `select product_id, day, min_price, avg_price from daily_series order by product_id, day`,
);
const deals = await sel(`
  select product_id, best_store_id,
         round(((avg_30d - best_price) / avg_30d * 100)::numeric, 2) discount_pct
  from price_aggregate
  where avg_30d is not null and avg_30d > 0 and best_price is not null
    and best_store_id is not null and best_price < avg_30d * 0.9
  order by discount_pct desc
  limit 120`);
const cand = await sel(
  `select p.id product_id, p.canonical_name, pa.stores_count, pa.best_price from product p join price_aggregate pa on pa.product_id = p.id`,
);
await c.end();

const catSort = new Map();
{
  const byParent = new Map();
  for (const c of cats) {
    const k = c.parent_id ?? 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    arr.forEach((c, i) => catSort.set(c.id, i + 1));
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
  cba.push([key, label, rubric, pool[0].product_id, sort]);
}

const now = new Date();
const parts = [];
parts.push('-- Precios Tandil — datos reales (generado desde Neon)');
parts.push(
  `-- ${now.toISOString()}  ·  productos=${prods.length} ofertas=${offers.length} historial=${hist.length} deals=${deals.length} cba=${cba.length}`,
);
parts.push('');
parts.push(
  'truncate table public.offers, public.price_history, public.deals, public.cba_items, public.products, public.categories, public.stores;',
);
parts.push('');
parts.push(
  stmt(
    'stores',
    ['id', 'slug', 'name', 'base_url', 'is_active'],
    stores.map((s) => [s.id, s.slug, s.name, s.base_url, s.is_active]),
  ),
);
parts.push('');
parts.push(
  stmt(
    'categories',
    ['id', 'slug', 'name', 'parent_id', 'sort'],
    cats.map((c) => [c.id, c.slug, c.name, c.parent_id, catSort.get(c.id) ?? 0]),
  ),
);
parts.push('');
parts.push(
  stmt(
    'products',
    [
      'id',
      'slug',
      'canonical_name',
      'brand',
      'ean',
      'unit_amount',
      'unit_type',
      'image_url',
      'category_id',
      'created_at',
    ],
    prods.map((p) => [
      p.id,
      p.slug,
      p.canonical_name,
      p.brand,
      p.ean,
      p.unit_amount,
      p.unit_type,
      p.image_url,
      p.category_id,
      p.created_at,
    ]),
    250,
  ),
);
parts.push('');
parts.push(
  stmt(
    'offers',
    ['product_id', 'store_id', 'price', 'source_url', 'captured_at'],
    offers.map((o) => [o.product_id, o.store_id, o.price_amount, o.source_url, o.captured_at]),
    500,
  ),
);
parts.push('');
parts.push(
  stmt(
    'price_history',
    ['product_id', 'day', 'min_price', 'avg_price'],
    hist.map((h) => [h.product_id, h.day, h.min_price, h.avg_price]),
    500,
  ),
);
parts.push('');
if (deals.length) {
  const badge = (d) => (d >= 20 ? 'Mejor Oportunidad de la Semana' : 'Precio bajó');
  parts.push(
    stmt(
      'deals',
      ['product_id', 'store_id', 'discount_pct', 'badge', 'status', 'published_at', 'expires_at'],
      deals.map((d) => [
        d.product_id,
        d.best_store_id,
        d.discount_pct,
        badge(Number(d.discount_pct)),
        'published',
        now.toISOString(),
        new Date(now.getTime() + 7 * 864e5).toISOString(),
      ]),
    ),
  );
  parts.push('');
}
parts.push(stmt('cba_items', ['key', 'label', 'rubric', 'product_id', 'sort'], cba));
parts.push('');

writeFileSync(OUT, parts.join('\n'), 'utf8');
console.log(`wrote ${OUT}`);
console.log(
  `stores=${stores.length} categories=${cats.length} products=${prods.length} offers=${offers.length} history=${hist.length} deals=${deals.length} cba=${cba.length}`,
);
