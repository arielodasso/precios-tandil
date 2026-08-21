import { describe, expect, it } from 'vitest';
import { formatArs, parsePrice, pctChange } from '../src/money.ts';
import { artParts, currentArtDateKey, freshnessHours, nightlyWindowUtc } from '../src/time.ts';

describe('parsePrice', () => {
  it('parsea formatos es-AR con miles y decimales', () => {
    expect(parsePrice('$ 1.590,00')).toBe(1590);
    expect(parsePrice('1.590,99')).toBe(1590.99);
    expect(parsePrice('1590')).toBe(1590);
    expect(parsePrice('2,5')).toBe(2.5);
  });

  it('acepta números válidos y rechaza inválidos', () => {
    expect(parsePrice(1234.567)).toBe(1234.57);
    expect(parsePrice(-1)).toBeNull();
    expect(parsePrice(0)).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
  });
});

describe('formatArs', () => {
  it('formatea moneda argentina', () => {
    expect(formatArs(1590)).toContain('1.590');
  });
});

describe('pctChange', () => {
  it('calcula variación porcentual redondeada', () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(100, 0)).toBeNull();
  });
});

describe('time ART', () => {
  it('artParts refleja la zona America/Argentina/Buenos_Aires', () => {
    const utcNoon = new Date('2026-08-20T12:00:00Z');
    const p = artParts(utcNoon);
    expect(p.hour).toBe(9);
    expect(p.year).toBe(2026);
    expect(p.month).toBe(8);
    expect(p.day).toBe(20);
  });

  it('currentArtDateKey devuelve YYYY-MM-DD', () => {
    expect(currentArtDateKey(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02');
  });

  it('nightlyWindowUtc mapea 00:00-06:00 ART a UTC', () => {
    const w = nightlyWindowUtc('2026-08-20');
    expect(w.startUtc.toISOString()).toBe('2026-08-20T03:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-08-20T09:00:00.000Z');
  });

  it('freshnessHours calcula horas transcurridas', () => {
    const now = new Date('2026-08-20T15:00:00Z');
    expect(freshnessHours('2026-08-20T13:00:00Z', now)).toBe(2);
    expect(freshnessHours('2026-08-21T13:00:00Z', now)).toBe(0);
  });
});
