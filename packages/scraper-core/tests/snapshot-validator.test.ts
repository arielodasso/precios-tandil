import { describe, expect, it } from 'vitest';
import { isValidEan13, validateSnapshot } from '../src/validation/snapshot-validator.ts';

const baseSnapshot = {
  externalId: 'sku-123',
  url: 'https://diaonline.supermercadosdia.com.ar/arroz-gallo-1kg/p',
  rawDescription: 'Arroz Gallo Oro 1 Kg',
  ean: '7791234567898',
  price: { amount: 1590, listOrPromo: 'list' },
  capturedAt: new Date().toISOString(),
};

const opts = { allowedHosts: ['supermercadosdia.com.ar'] };

describe('isValidEan13', () => {
  it('valida checksum correcto', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
  });

  it('rechaza checksum incorrecto', () => {
    expect(isValidEan13('4006381333932')).toBe(false);
  });

  it('rechaza formato no numérico o largo incorrecto', () => {
    expect(isValidEan13('abcd')).toBe(false);
    expect(isValidEan13('12345678901234')).toBe(false);
  });
});

describe('validateSnapshot', () => {
  it('acepta un snapshot válido', () => {
    const res = validateSnapshot(baseSnapshot, opts);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.price.amount).toBe(1590);
  });

  it('rechaza precio <= 0 con invalid_price', () => {
    const res = validateSnapshot({ ...baseSnapshot, price: { amount: -5 } }, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_price');
  });

  it('rechaza snapshot malformado con invalid_snapshot', () => {
    const res = validateSnapshot({ externalId: '' }, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_snapshot');
  });

  it('rechaza URL fuera del dominio de la tienda', () => {
    const res = validateSnapshot(
      { ...baseSnapshot, url: 'https://otro-sitio.com.ar/producto/p' },
      opts,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_source_url');
  });

  it('acepta subdominios del dominio permitido', () => {
    const res = validateSnapshot(
      { ...baseSnapshot, url: 'https://www.diaonline.supermercadosdia.com.ar/x/p' },
      opts,
    );
    expect(res.ok).toBe(true);
  });

  it('descarta EAN con checksum inválido y agrega warning sin rechazar', () => {
    const res = validateSnapshot({ ...baseSnapshot, ean: '7791234567899' }, opts);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.ean).toBeUndefined();
      expect(res.warnings.length).toBe(1);
    }
  });
});
