import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isValidEan13, validateSnapshot } from '@precios/scraper-core';
import { normalizeDescription } from '@precios/normalizer';
import adapter, { extractProducts, parseProducts, type GolopolisProduct } from '../src/index.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/golopolis-arroz.json', import.meta.url));
const ALLOWED_HOSTS = ['golopolis.com.ar', 'www.golopolis.com.ar'];

const products = JSON.parse(readFileSync(FIXTURE, 'utf8')) as GolopolisProduct[];
const snapshots = parseProducts(products, new Date(), 'Arroz y Legumbres');
const byExternalId = new Map(snapshots.map((s) => [s.externalId, s] as const));

describe('adaptador Golopolis — contract test contra fixture congelado', () => {
  it('expone el slug de tienda correcto', () => {
    expect(adapter.storeSlug).toBe('golopolis');
  });

  it('extrae un snapshot por producto del listado real', () => {
    expect(snapshots.length).toBeGreaterThanOrEqual(20);
    const ids = snapshots.map((s) => s.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todos los snapshots superan la validación del pipeline', () => {
    for (const snap of snapshots) {
      const result = validateSnapshot(snap, { allowedHosts: ALLOWED_HOSTS });
      expect(result.ok, `fallo en ${snap.externalId}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('no deja pasar la validación si se mete una URL ajena', () => {
    const foreign = validateSnapshot(
      { ...snapshots[0]!, url: 'https://evil.example.com/steal' },
      { allowedHosts: ALLOWED_HOSTS },
    );
    expect(foreign.ok).toBe(false);
  });

  it('captura precio, EAN, marca y unidad del arroz por kilo', () => {
    const snap = byExternalId.get('46230')!;
    expect(snap.price.amount).toBeCloseTo(3463.54, 2);
    expect(snap.price.listOrPromo).toBe('list');
    expect(snap.ean).toBe('7792710001516');
    expect(isValidEan13(snap.ean!)).toBe(true);
    expect(snap.brand).toBe('AMANDA');

    const norm = normalizeDescription(snap.rawDescription);
    expect(norm.unitType).toBe('kg');
    expect(norm.unitAmount).toBe(1);
  });

  it('clasifica la promo real contra el precio de lista', () => {
    const snap = byExternalId.get('9928')!;
    expect(snap.price.listOrPromo).toBe('promo');
    expect(snap.price.amount).toBeCloseTo(989.26, 2);
    expect(snap.price.amount).toBeLessThan(1100);
  });

  it('genera URLs canónicas dentro del dominio Golopolis', () => {
    for (const snap of snapshots) {
      const url = new URL(snap.url);
      expect(url.hostname).toBe('www.golopolis.com.ar');
      expect(url.searchParams.get('action')).toBe('detail');
      expect(url.searchParams.get('itemId')).toBe(snap.externalId);
    }
  });

  it('arma la URL de imagen absoluta desde el path relativo', () => {
    const snap = byExternalId.get('46230')!;
    expect(snap.imageUrl).toBe(
      'https://www.golopolis.com.ar/app/files/company_21/products/198267_7792710001516.webp',
    );
  });

  it('conserva el path de categoría recortado (sin espacios de cola)', () => {
    for (const snap of snapshots) {
      expect(snap.categoryPath).toBeDefined();
      expect(snap.categoryPath!.length).toBeGreaterThanOrEqual(1);
      for (const part of snap.categoryPath!) expect(part.endsWith(' ')).toBe(false);
    }
    expect(byExternalId.get('46230')!.categoryPath).toEqual(['Almacen', 'Arroz y Legumbres']);
  });

  it('parsea el array evaluado inline del HTML del listado', () => {
    const html = `<!doctype html><html><body>
      <script>var aProducts = ${JSON.stringify(products.slice(0, 2))};</script>
    </body></html>`;
    const parsed = parseProducts(extractProducts(html));
    expect(parsed.length).toBe(2);
    expect(parsed[0]!.externalId).toBe('46230');
  });
});
