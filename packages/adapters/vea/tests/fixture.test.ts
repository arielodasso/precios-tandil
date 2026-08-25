import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isValidEan13, validateSnapshot } from '@precios/scraper-core';
import { normalizeDescription } from '@precios/normalizer';
import adapter, { parseListing } from '../src/index.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/vea-listing-arroz.html', import.meta.url));

const ALLOWED_HOSTS = ['vea.com.ar'];

const html = readFileSync(FIXTURE, 'utf8');
const snapshots = parseListing(html);
const byExternalId = new Map(snapshots.map((s) => [s.externalId, s] as const));

describe('adaptador Vea — contract test contra fixture congelado', () => {
  it('expone el slug de tienda correcto', () => {
    expect(adapter.storeSlug).toBe('vea');
  });

  it('extrae un snapshot por SKU de la categoría real', () => {
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

  it('captura precio y EAN del SKU conocido (Molinos Ala 1 kg)', () => {
    const snap = byExternalId.get('2975');
    expect(snap).toBeDefined();
    expect(snap!.price.amount).toBeCloseTo(1890, 2);
    expect(snap!.ean).toBe('7791120031557');
    expect(isValidEan13(snap!.ean!)).toBe(true);
  });

  it('normaliza unidades kg desde la descripción', () => {
    const snap = byExternalId.get('2975')!;
    const norm = normalizeDescription(snap.rawDescription);
    expect(norm.unitType).toBe('kg');
    expect(norm.unitAmount).toBe(1);
  });

  it('normaliza unidad g en el paquete de 500 grs', () => {
    const snap = byExternalId.get('403662')!;
    const norm = normalizeDescription(snap.rawDescription);
    expect(norm.unitType).toBe('g');
    expect(norm.unitAmount).toBe(500);
  });

  it('clasifica ofertas promocionales contra el precio de lista del caché', () => {
    const promos = snapshots.filter((s) => s.price.listOrPromo === 'promo');
    expect(promos.length).toBeGreaterThanOrEqual(4);
    for (const promo of promos) {
      expect(promo.price.amount).toBeGreaterThan(0);
    }
  });

  it('genera URLs canónicas dentro del dominio Vea', () => {
    for (const snap of snapshots) {
      expect(new URL(snap.url).hostname).toBe('www.vea.com.ar');
      expect(new URL(snap.url).pathname.endsWith('/p')).toBe(true);
    }
  });

  it('conserva la ruta de categoría del caché VTEX', () => {
    const withCategory = snapshots.filter((s) => s.categoryPath && s.categoryPath.length > 0);
    expect(withCategory.length).toBeGreaterThan(0);
    expect(withCategory[0]!.categoryPath![0]).toBe('Almacén');
  });
});
