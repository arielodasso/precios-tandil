/**
 * Captura y congela un fixture estructural de la API JSON pública de Monarca
 * (web.monarcadigital.com.ar, app Next.js con backend /api/*).
 * No requiere navegador: la API responde JSON a HTTP plano.
 *
 * Uso: node scripts/capture-fixture.mjs
 * Regenera tests/fixtures/monarca-search-arroz.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_URL =
  'https://web.monarcadigital.com.ar/api/products/search?page=0&query=&size=20&categoryId=10043';
const OUTPUT = join(__dirname, '..', 'tests', 'fixtures', 'monarca-search-arroz.json');
const KEEP_PRODUCTS = 8;
const UA =
  'Mozilla/5.0 (Windows NT 10; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const res = await fetch(SOURCE_URL, {
  headers: { accept: 'application/json', 'user-agent': UA },
});
if (!res.ok) {
  throw new Error(`HTTP ${res.status} en ${SOURCE_URL}`);
}
const data = await res.json();

const content = data?.products?.content;
if (!Array.isArray(content) || content.length === 0) {
  throw new Error(`Sin productos en la respuesta de ${SOURCE_URL}`);
}

const trimmed = {
  ...data,
  products: {
    ...data.products,
    content: content.slice(0, KEEP_PRODUCTS),
    numberOfElements: Math.min(KEEP_PRODUCTS, content.length),
  },
};

console.log(`Productos totales en categoría: ${data.products.totalElements}`);
console.log(`Conservados: ${trimmed.products.content.length}`);

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(trimmed, null, 2)}\n`);
console.log(
  `Fixture escrito: ${OUTPUT} (${Math.round(Buffer.byteLength(JSON.stringify(trimmed)) / 1024)} KB)`,
);
