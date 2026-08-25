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

test.describe('US1 — Comparar precios en góndola', () => {
  test.beforeEach(async () => {
    const available = await apiAvailable();
    test.skip(!available, 'API no disponible — stack completo necesario');
  });

  test('buscar "arroz" muestra resultados en la barra de búsqueda', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByRole('searchbox', { name: /buscar producto/i });
    await expect(searchInput).toBeVisible();

    await searchInput.fill('arroz');
    await page.waitForTimeout(500);

    const suggestions = page.locator('[role="search"] ul li button');
    const count = await suggestions.count();
    expect(count).toBeGreaterThan(0);
  });

  test('hacer clic en un resultado navega a la página del producto', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByRole('searchbox', { name: /buscar producto/i });
    await searchInput.fill('arroz');
    await page.waitForTimeout(500);

    const firstResult = page.locator('[role="search"] ul li button').first();
    await firstResult.click();

    await page.waitForURL(/\/p\//);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('página de producto muestra tarjeta comparativa con ofertas', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByRole('searchbox', { name: /buscar producto/i });
    await searchInput.fill('arroz');
    await page.waitForTimeout(500);

    const firstResult = page.locator('[role="search"] ul li button').first();
    await firstResult.click();
    await page.waitForURL(/\/p\//);

    const card = page.locator('section').first();
    await expect(card).toBeVisible();

    const h1 = page.locator('h1');
    await expect(h1).not.toBeEmpty();
  });

  test('página de producto tiene JSON-LD válido', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByRole('searchbox', { name: /buscar producto/i });
    await searchInput.fill('arroz');
    await page.waitForTimeout(500);

    const firstResult = page.locator('[role="search"] ul li button').first();
    await firstResult.click();
    await page.waitForURL(/\/p\//);

    const jsonLd = page.locator('script[type="application/ld+json"]');
    await expect(jsonLd).toHaveCount(1);

    const content = await jsonLd.textContent();
    const parsed = JSON.parse(content!);
    expect(parsed['@type']).toBe('Product');
    expect(parsed.offers).toBeDefined();
  });

  test('home muestra categorías y sección de oportunidades', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('¿Dónde conviene comprar');
    await expect(page.getByRole('navigation', { name: /categorías/i })).toBeVisible();
  });

  test('toggle dark/light funciona', async ({ page }) => {
    await page.goto('/');

    const toggle = page.getByRole('button', { name: /modo (claro|oscuro)/i });
    await expect(toggle).toBeVisible();

    const htmlBefore = await page.locator('html').getAttribute('class');
    await toggle.click();
    const htmlAfter = await page.locator('html').getAttribute('class');

    expect(htmlBefore).not.toBe(htmlAfter);
  });
});
