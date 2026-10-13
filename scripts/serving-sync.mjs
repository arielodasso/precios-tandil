import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const INGEST_SECRET = process.env.INGEST_SECRET;
const INGEST_URL = process.env.INGEST_URL || 'https://preciostandil.com/api/ingest';
const BATCH_SIZE = 3000;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!INGEST_SECRET) {
  console.error('INGEST_SECRET is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 5 });

async function postTable(table, rows) {
  if (rows.length === 0) return;
  console.log(`Enviando ${rows.length} filas a ${table}...`);
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${INGEST_SECRET}`,
      },
      body: JSON.stringify({ table, rows: chunk }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Fallo envio a ${table} (chunk ${i}-${i + chunk.length}): ${res.status} ${err}`);
    }
  }
}

async function main() {
  console.log('--- Sincronizando hacia Precios Tandil Web ---');
  
  const stores = await sql`SELECT * FROM stores`;
  await postTable('stores', stores);

  const categories = await sql`SELECT * FROM categories`;
  await postTable('categories', categories);

  const products = await sql`SELECT * FROM products`;
  await postTable('products', products);

  const offers = await sql`SELECT * FROM offers`;
  await postTable('offers', offers);

  const historyDays = Number(process.env.HISTORY_DAYS || '30');
  const priceHistory = await sql`
    SELECT * FROM price_history 
    WHERE captured_at >= NOW() - (${historyDays} || ' days')::interval
  `;
  await postTable('price_history', priceHistory);

  const deals = await sql`SELECT * FROM deals`;
  await postTable('deals', deals);

  const cbaItems = await sql`SELECT * FROM cba_items`;
  await postTable('cba_items', cbaItems);

  console.log('--- Sincronizacion completada con exito ---');
  await sql.end();
}

main().catch(async (err) => {
  console.error('Error en sync:', err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
