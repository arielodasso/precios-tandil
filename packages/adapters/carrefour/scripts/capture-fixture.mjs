/**
 * Captura y congela un fixture estructural del caché Apollo (VTEX IO) de Carrefour AR.
 *
 * Uso: node scripts/capture-fixture.mjs
 * Regenera tests/fixtures/carrefour-category-arroz.html a partir de la página real.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// La URL corta /arroz SSR-vacía y redirige client-side; usar la categoría canónica.
const SOURCE_URL = 'https://www.carrefour.com.ar/almacen/arroz-y-legumbres/arroz';
const OUTPUT = join(__dirname, '..', 'tests', 'fixtures', 'carrefour-category-arroz.html');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const KEEP_PRODUCTS = 8;

function extractApolloCache(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  let best = null;
  let bestSize = -1;
  for (const s of scripts) {
    const body = s[1].trim();
    if (!body.startsWith('{')) continue;
    try {
      const data = JSON.parse(body);
      const size = Buffer.byteLength(body);
      if (Object.keys(data).some((k) => /^Product:[^$.]+/.test(k)) && size > bestSize) {
        best = data;
        bestSize = size;
      }
    } catch {
      /* siguiente script */
    }
  }
  if (!best) throw new Error(`Sin caché Apollo de productos en ${SOURCE_URL}`);
  return best;
}

/** Poda subgrafos irrelevantes para precios (cuotas, teasers) antes del recorte. */
function pruneCache(data) {
  const pruned = {};
  for (const [k, v] of Object.entries(data)) {
    if (/\.Installments\(/.test(k) || (/\.teasers(\.\d+)?$/.test(k) && !k.startsWith('$')))
      continue;
    if (/commertialOffer\.teasers/.test(k)) continue;
    if (/discountHighlights/.test(k)) continue;
    pruned[k] = v;
  }
  return pruned;
}

/** BFS por refs {type:'id'} para conservar integridad referencial del subgrafo. */
function trimCache(data, keepProducts) {
  const roots = Object.keys(data).filter((k) => /^Product:[^$.]+$/.test(k));
  if (roots.length < keepProducts) {
    console.warn(`Solo ${roots.length} productos en caché (se pidieron ${keepProducts})`);
  }
  const seeds = [];
  for (const root of roots.slice(0, keepProducts)) {
    seeds.push([root, data[root]]);
    const prefix = `${root}.items(`;
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith(prefix)) seeds.push([k, v]);
    }
  }

  const kept = new Map();
  const visit = (key, value) => {
    if (kept.has(key)) return;
    kept.set(key, value);
    walk(value);
  };
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === 'object') {
      if (value.type === 'id' && typeof value.id === 'string' && data[value.id] !== undefined) {
        visit(value.id, data[value.id]);
        return;
      }
      for (const v of Object.values(value)) walk(v);
    }
  };
  for (const [k, v] of seeds) visit(k, v);
  return kept;
}

function buildShell(title, cacheJson, capturedAt) {
  return `<!DOCTYPE html>
<!-- Fixture estructural congelado. Origen real: ${SOURCE_URL} -->
<!-- Capturado: ${capturedAt} | Plataforma: VTEX IO con caché GraphQL de productos embebida -->
<!-- Regenerar: node scripts/capture-fixture.mjs -->
<html lang="es-AR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script>${cacheJson}</script>
  </body>
</html>
`;
}

async function main() {
  const res = await fetch(SOURCE_URL, { headers: { 'user-agent': UA, accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${SOURCE_URL}`);
  const html = await res.text();
  const cache = pruneCache(extractApolloCache(html));
  const trimmed = trimCache(cache, KEEP_PRODUCTS);
  const trimmedJson = JSON.stringify(Object.fromEntries(trimmed));
  const bytes = Buffer.byteLength(trimmedJson);
  console.log(
    `Productos conservados: ${[...trimmed.keys()].filter((k) => /^Product:[^$.]+$/.test(k)).length}`,
  );
  console.log(`Entradas caché: ${trimmed.size} (~${Math.round(bytes / 1024)} KB)`);

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Carrefour Argentina';
  const shell = buildShell(
    title,
    trimmedJson,
    new Date().toISOString().replace('T', ' ').slice(0, 16) + ' ART aprox',
  );
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, shell);
  console.log(`Fixture escrito: ${OUTPUT} (${Math.round(Buffer.byteLength(shell) / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
