import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isValidEan13, validateSnapshot } from '@precios/scraper-core';
import { normalizeDescription } from '@precios/normalizer';
import adapter, { parseListing } from '../src/index.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/dia-listing-arroz.html', import.meta.url));

const ALLOWED_HOSTS = ['diaonline.supermercadosdia.com.ar'];

const html = readFileSync(FIXTURE, 'utf8');
const snapshots = parseListing(html);
const byExternalId = new Map(snapshots.map((s) => [s.externalId, s] as const));

describe('adaptador DIA — contract test contra fixture congelado', () => {
  it('expone el slug de tienda correcto', () => {
    expect(adapter.storeSlug).toBe('dia');
  });

  it('extrae un snapshot por SKU del listado real', () => {
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

  it('captura precio promocional y EAN con checksum válido del producto conocido', () => {
    const snap = byExternalId.get('33019');
    expect(snap).toBeDefined();
    expect(snap!.price.amount).toBe(1800);
    expect(snap!.price.listOrPromo).toBe('promo');
    expect(snap!.ean).toBe('7791120037559');
    expect(isValidEan13(snap!.ean!)).toBe(true);
    expect(snap!.brand?.toLowerCase()).toContain('molinos ala');
  });

  it('normaliza unidades kg y g desde la descripción', () => {
    const kilo = normalizeDescription(byExternalId.get('33019')!.rawDescription);
    expect(kilo.unitType).toBe('kg');
    expect(kilo.unitAmount).toBe(1);

    const medioKilo = normalizeDescription(byExternalId.get('258586')!.rawDescription);
    expect(medioKilo.unitType).toBe('g');
    expect(medioKilo.unitAmount).toBe(500);
  });

  it('clasifica ofertas promocionales y precios de lista', () => {
    const promos = snapshots.filter((s) => s.price.listOrPromo === 'promo');
    const lists = snapshots.filter((s) => s.price.listOrPromo === 'list');
    expect(promos.length).toBeGreaterThan(0);
    expect(lists.length).toBeGreaterThan(0);
  });

  it('genera URLs canónicas dentro del dominio DIA', () => {
    for (const snap of snapshots) {
      expect(new URL(snap.url).hostname).toBe(ALLOWED_HOSTS[0]);
      expect(new URL(snap.url).pathname.endsWith('/p')).toBe(true);
    }
  });

  it('registra capturedAt con zona horaria explícita', () => {
    for (const snap of snapshots) {
      expect(() => new Date(snap.capturedAt)).not.toThrow();
      expect(/(Z|[+-]\d{2}:\d{2})$/.test(snap.capturedAt)).toBe(true);
    }
  });
});
