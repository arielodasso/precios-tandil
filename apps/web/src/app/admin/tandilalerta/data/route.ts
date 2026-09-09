import { sql } from 'kysely';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s) || s.startsWith(' ') || s.endsWith(' '))
    return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(';')).join('\r\n');
  return '\uFEFF' + lines;
}

export async function GET() {
  const db = getDb();

  const rows = await sql<{
    producto: string;
    marca: string | null;
    ean: string | null;
    categoria: string | null;
    tienda: string;
    sku: string;
    precio: string;
    precio_unitario: string | null;
    unidad: string | null;
    precio_lista_o_promo: string;
    url: string;
    capturado_el: string;
  }>`
    with ultimos as (
      select store_sku_id, price_amount, currency, list_or_promo, unit_price,
             source_url, captured_at,
             row_number() over (
               partition by store_sku_id order by captured_at desc, id desc
             ) as rn
      from price_record
      where is_suspect = false
    )
    select pr.price_amount::text as precio,
           pr.unit_price::text as precio_unitario,
           pr.list_or_promo as precio_lista_o_promo,
           coalesce(pr.source_url, ss.url) as url,
           to_char(pr.captured_at, 'YYYY-MM-DD HH24:MI') as capturado_el,
           p.canonical_name as producto,
           p.brand as marca,
           p.ean as ean,
           c.name as categoria,
           s.name as tienda,
           ss.external_id as sku,
           ss.unit_label as unidad
    from ultimos pr
    join store_sku ss on ss.id = pr.store_sku_id
    join store s on s.id = ss.store_id
    join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto', 'confirmed')
    join product p on p.id = ml.product_id
    left join category c on c.id = p.category_id
    where pr.rn = 1
    order by p.canonical_name asc, s.name asc
  `.execute(db);

  const data = rows.rows.map((r) => [
    r.producto,
    r.marca,
    r.ean,
    r.categoria,
    r.tienda,
    r.sku,
    r.precio,
    r.precio_unitario,
    r.unidad,
    r.precio_lista_o_promo,
    r.capturado_el,
    r.url,
  ]);

  const headers = [
    'producto',
    'marca',
    'ean',
    'categoria',
    'tienda',
    'sku',
    'precio',
    'precio_unitario',
    'unidad',
    'lista_o_promo',
    'capturado_el',
    'url',
  ];

  const body = toCsv(headers, data);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': 'attachment; filename="precios-tandil-base.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
