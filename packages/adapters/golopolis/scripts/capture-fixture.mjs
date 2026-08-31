/**
 * Captura y congela un fixture estructural del listado HTML de Golopolis
 * (golopolis.com.ar/app). Guarda el array `aProducts` recortado, que es lo que
 * consume el parser.
 *
 * Uso: node scripts/capture-fixture.mjs
 * Regenera tests/fixtures/golopolis-arroz.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_URL = 'https://www.golopolis.com.ar/app/?action=products&superItemId=1&itemId=6';
const OUTPUT = join(__dirname, '..', 'tests', 'fixtures', 'golopolis-arroz.json');
const KEEP_PRODUCTS = 25;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const res = await fetch(SOURCE_URL, { headers: { 'user-agent': UA, accept: 'text/html' } });
if (!res.ok) {
  throw new Error(`HTTP ${res.status} en ${SOURCE_URL}`);
}
const html = await res.text();

const m = /var aProducts\s*=\s*(\[[\s\S]*?\])\s*;/.exec(html);
if (!m) throw new Error(`No se encontró 'var aProducts' en ${SOURCE_URL}`);
const products = JSON.parse(m[1]);
if (!Array.isArray(products) || products.length === 0) {
  throw new Error(`Sin productos en la respuesta de ${SOURCE_URL}`);
}
console.log(`Productos totales en categoría: ${products.length}`);

const trimmed = products.slice(0, KEEP_PRODUCTS);
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(trimmed, null, 2)}\n`);
console.log(
  `Fixture escrito: ${OUTPUT} (${Math.round(Buffer.byteLength(JSON.stringify(trimmed)) / 1024)} KB, ${trimmed.length} productos)`,
);
