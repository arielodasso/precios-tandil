import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

const PAGE = 50_000;

const HEADERS = [
  'producto',
  'marca',
  'ean',
  'categoria',
  'tienda',
  'sku',
  'precio',
  'lista_o_promo',
  'unidad',
  'capturado_el',
  'fecha_corrida',
  'url_origen',
  'run_id',
  'es_sospechoso',
];

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s) || s.startsWith(' ') || s.endsWith(' '))
    return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const encoder = new TextEncoder();

export async function GET() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no configurada');

  const pool = new Pool({
    connectionString: url,
    max: 1,
    ssl: url.includes('sslmode') ? { rejectUnauthorized: false } : undefined,
  });

  const cursorSql = `
    select pr.id,
           pr.captured_at,
           p.canonical_name as producto,
           p.brand as marca,
           p.ean as ean,
           c.name as categoria,
           s.name as tienda,
           ss.external_id as sku,
           pr.price_amount::text as precio,
           pr.list_or_promo as lista_o_promo,
           ss.unit_label as unidad,
           to_char(pr.captured_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as capturado_el,
           to_char(rr.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as fecha_corrida,
           coalesce(pr.source_url, ss.url) as url_origen,
           pr.run_id::text as run_id,
           pr.is_suspect as es_sospechoso
    from price_record pr
    join store_sku ss on ss.id = pr.store_sku_id
    join store s on s.id = ss.store_id
    join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto', 'confirmed')
    join product p on p.id = ml.product_id
    left join category c on c.id = p.category_id
    left join run_report rr on rr.run_id = pr.run_id::uuid
    where (pr.captured_at, pr.id) > ($1::timestamptz, $2::bigint)
    order by pr.captured_at asc, pr.id asc
    limit ${PAGE}
  `;

  const headerLine = '\uFEFF' + HEADERS.map(escapeCell).join(';') + '\r\n';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(headerLine));
        let cursor: [string, string] = ['1970-01-01 00:00:00+00', '0'];
        for (;;) {
          const result = await pool.query(cursorSql, cursor);
          const rows = result.rows as Array<Record<string, unknown>>;
          if (rows.length === 0) break;

          let lines = '';
          for (const r of rows) {
            lines +=
              [
                r.producto,
                r.marca,
                r.ean,
                r.categoria,
                r.tienda,
                r.sku,
                r.precio,
                r.lista_o_promo,
                r.unidad,
                r.capturado_el,
                r.fecha_corrida,
                r.url_origen,
                r.run_id,
                r.es_sospechoso,
              ]
                .map(escapeCell)
                .join(';') + '\r\n';
          }
          controller.enqueue(encoder.encode(lines));

          if (rows.length < PAGE) break;
          const last = rows[rows.length - 1];
          cursor = [String(last.captured_at), String(last.id)];
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        await pool.end();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': 'attachment; filename="precios-tandil-historial.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
