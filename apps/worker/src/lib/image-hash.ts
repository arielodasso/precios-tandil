import type { BrowserContext } from 'playwright';

const HASH_FN = `(async () => {
  const load = () => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('img-error'));
    img.src = __URL__;
  });
  let img;
  try { img = await load(); } catch { return null; }
  try {
    const c = document.createElement('canvas');
    c.width = 9; c.height = 8;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    const g = (i) => Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const idx = y * 9 + x;
        bits += g(idx) >= g(idx + 1) ? '1' : '0';
      }
    }
    return BigInt('0b' + bits).toString(16).padStart(16, '0');
  } catch { return null; }
})()`;

/**
 * Hash perceptual (dHash horizontal 64-bit, hex) de una imagen remota usando
 * canvas de Chromium vía Playwright. Devuelve null si la imagen no carga o el
 * canvas queda contaminado (CORS).
 */
export async function computeImageHash(
  browser: BrowserContext,
  imageUrl: string,
  timeoutMs = 20_000,
): Promise<string | null> {
  let page: Awaited<ReturnType<BrowserContext['newPage']>> | null = null;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.setContent('<!doctype html><html><body></body></html>', {
      timeout: Math.min(timeoutMs, 5000),
    });
    const urlLiteral = JSON.stringify(imageUrl);
    return await page.evaluate(HASH_FN.replace('__URL__', urlLiteral));
  } catch {
    return null;
  } finally {
    await page?.close().catch(() => {});
  }
}
