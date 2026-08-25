import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isValidEan13, validateSnapshot } from '@precios/scraper-core';
import { normalizeDescription } from '@precios/normalizer';
import adapter, { parseSearchResponse, type MonarcaSearchResponse } from '../src/index.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/monarca-search-arroz.json', import.meta.url));

const ALLOWED_HOSTS = ['web.monarcadigital.com.ar'];

const payload = JSON.parse(readFileSync(FIXTURE, 'utf8')) as MonarcaSearchResponse;
const snapshots = parseSearchResponse(payload);
const byExternalId = new Map(snapshots.map((s) => [s.externalId, s] as const));

describe('adaptador Monarca — contract test contra fixture congelado', () => {
  it('expone el slug de tienda correcto', () => {
    expect(adapter.storeSlug).toBe('monarca');
  });

  it('extrae un snapshot por producto de la búsqueda real', () => {
    expect(snapshots.length).toBeGreaterThanOrEqual(8);
    const ids = snapshots.map((s) => s.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todos los snapshots superan la validación del pipeline', () => {
    for (const snap of snapshots) {
      const result = validateSnapshot(snap, { allowedHosts: ALLOWED_HOSTS });
      expect(result.ok, `fallo en ${snap.externalId}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('captura precio y EAN del SKU conocido (Arroz Largo Fino)', () => {
    const snap = byExternalId.get('911205');
    expect(snap).toBeDefined();
    expect(snap!.price.amount).toBeCloseTo(2050, 2);
    expect(snap!.price.listOrPromo).toBe('list');
    expect(snap!.ean).toBe('7790070431486');
    expect(isValidEan13(snap!.ean!)).toBe(true);
  });

  it('normaliza unidades kg desde la descripción con presentación', () => {
    const snap = byExternalId.get('911205')!;
    const norm = normalizeDescription(snap.rawDescription);
    expect(norm.unitType).toBe('kg');
    expect(norm.unitAmount).toBe(1);
  });

  it('normaliza unidad g en el paquete de 500 grs', () => {
    const snap = byExternalId.get('913471')!;
    const norm = normalizeDescription(snap.rawDescription);
    expect(norm.unitType).toBe('g');
    expect(norm.unitAmount).toBe(500);
  });

  it('clasifica promociones activas contra el precio de lista', () => {
    const promos = snapshots.filter((s) => s.price.listOrPromo === 'promo');
    expect(promos.length).toBeGreaterThanOrEqual(2);
    for (const promo of promos) {
      expect(promo.price.promoLabel).toBeTruthy();
      expect(promo.price.amount).toBeGreaterThan(0);
    }

    const parboil = byExternalId.get('911208')!;
    expect(parboil.price.amount).toBeCloseTo(1762.5, 2);
    expect(parboil.price.amount).toBeLessThan(2350);
  });

  it('conserva el precio por unidad de referencia cuando existe', () => {
    const withUnit = snapshots.filter((s) => s.price.unitPrice !== undefined);
    expect(withUnit.length).toBeGreaterThan(0);
    for (const snap of withUnit) {
      expect(snap.price.unitPrice!).toBeGreaterThan(0);
    }
  });

  it('genera URLs canónicas dentro del dominio Monarca', () => {
    for (const snap of snapshots) {
      expect(new URL(snap.url).hostname).toBe('web.monarcadigital.com.ar');
      expect(new URL(snap.url).pathname).toMatch(/^\/products\/\d+$/);
    }
  });

  it('conserva la categoría hoja del producto', () => {
    const withCategory = snapshots.filter((s) => s.categoryPath && s.categoryPath.length > 0);
    expect(withCategory.length).toBe(snapshots.length);
    const largoFino = byExternalId.get('911205')!;
    expect(largoFino.categoryPath).toContain('LARGO FINO');
  });
});
