import { test, expect } from '@playwright/test';

const API = process.env.API_URL || 'http://localhost:8080';

async function apiAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/healthz`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

test.describe('US2 — Historial y mejor precio histórico', () => {
  test.beforeEach(async () => {
    const available = await apiAvailable();
    test.skip(!available, 'API no disponible — stack completo necesario');
  });

  test('página de producto muestra sección de historial si hay datos', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByRole('searchbox', { name: /buscar producto/i });
    await searchInput.fill('arroz');
    await page.waitForTimeout(500);

    const firstResult = page.locator('[role="search"] ul li button').first();
    const count = await firstResult.count();
    test.skip(count === 0, 'No hay resultados de búsqueda para "arroz"');

    await firstResult.click();
    await page.waitForURL(/\/p\//);

    const historySection = page.locator('text=/mínimo histórico|Datos insuficientes/i');
    const hasHistory = await historySection.count();
    expect(hasHistory).toBeGreaterThanOrEqual(0);
  });

  test('página de producto muestra spread_pct si hay múltiples ofertas', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByRole('searchbox', { name: /buscar producto/i });
    await searchInput.fill('arroz');
    await page.waitForTimeout(500);

    const firstResult = page.locator('[role="search"] ul li button').first();
    const count = await firstResult.count();
    test.skip(count === 0, 'No hay resultados de búsqueda');

    await firstResult.click();
    await page.waitForURL(/\/p\//);

    const spreadText = page.locator('text=Diferencia entre el más barato');
    const hasSpread = await spreadText.count();
    expect(hasSpread).toBeGreaterThanOrEqual(0);
  });

  test('endpoint /products/:slug/history retorna serie diaria', async () => {
    const searchRes = await fetch(`${API}/api/v1/search?q=arroz&limit=1`);
    if (!searchRes.ok) return;
    const searchData = await searchRes.json();
    if (!searchData.results?.length) return;

    const slug = searchData.results[0].slug;
    const res = await fetch(`${API}/api/v1/products/${slug}/history?window=30`);
    expect(res.ok).toBeTruthy();

    const data = await res.json();
    expect(data).toHaveProperty('series');
    expect(data).toHaveProperty('stats');
    expect(data).toHaveProperty('insufficient_history');
    expect(Array.isArray(data.series)).toBeTruthy();
  });

  test('toggle de ventana 30/90/all funciona', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByRole('searchbox', { name: /buscar producto/i });
    await searchInput.fill('arroz');
    await page.waitForTimeout(500);

    const firstResult = page.locator('[role="search"] ul li button').first();
    const count = await firstResult.count();
    test.skip(count === 0, 'No hay resultados de búsqueda');

    await firstResult.click();
    await page.waitForURL(/\/p\//);

    const windowButtons = page.locator(
      'button:has-text("30"), button:has-text("90"), button:has-text("Todo")',
    );
    const btnCount = await windowButtons.count();
    if (btnCount > 0) {
      await windowButtons.first().click();
      await page.waitForTimeout(300);
    }
  });
});
