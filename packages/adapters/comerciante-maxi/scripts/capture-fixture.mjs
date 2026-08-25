/**
 * Captura y congela un fixture estructural del caché Apollo (VTEX IO) de
 * Comerciante Maxi. La tienda es 100% client-rendered: se necesita un
 * navegador real para que el caché Apollo aparezca en el DOM.
 *
 * Uso: node scripts/capture-fixture.mjs   (requiere Chrome instalado)
 * Regenera tests/fixtures/maxi-category-arroz.html.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_URL = 'https://comerciante.carrefour.com.ar/category/Arroz%20y%20legumbres';
const OUTPUT = join(__dirname, '..', 'tests', 'fixtures', 'maxi-category-arroz.html');
const KEEP_PRODUCTS = 8;
const PLAYWRIGHT_PATH =
  'file:///C:/Users/Usuario/Desktop/ARIEL/precios/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';

const { chromium } = await import(PLAYWRIGHT_PATH);

function extractApolloCache(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  for (const s of scripts) {
    const raw = s[1] ?? '';
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      const data = JSON.parse(raw.slice(start, end + 1));
      if (Object.keys(data).some((k) => /^Product:[^$.]+/.test(k))) return data;
    } catch {
      /* siguiente script */
    }
  }
  throw new Error(`Sin caché Apollo de productos en la página renderizada de ${SOURCE_URL}`);
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
<!-- Regenerar: node scripts/capture-fixture.mjs (requiere Chrome local) -->
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
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('script')
      .filter({ hasText: '{"Product' })
      .first()
      .waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    var html = await page.content();
  } finally {
    await browser.close().catch(() => undefined);
  }

  const cache = extractApolloCache(html);
  const trimmed = trimCache(cache, KEEP_PRODUCTS);
  const trimmedJson = JSON.stringify(Object.fromEntries(trimmed));
  console.log(
    `Productos conservados: ${[...trimmed.keys()].filter((k) => /^Product:[^$.]+$/.test(k)).length}`,
  );
  console.log(
    `Entradas caché: ${trimmed.size} (~${Math.round(Buffer.byteLength(trimmedJson) / 1024)} KB)`,
  );

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Comerciante Carrefour';
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
