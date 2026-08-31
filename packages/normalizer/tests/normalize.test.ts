import { describe, expect, it } from 'vitest';
import { normalizeDescription } from '../src/clean/normalize.ts';

describe('normalizeDescription', () => {
  it('normaliza acentos y minúsculas', () => {
    const r = normalizeDescription('Aceite Girasol Cañuelas');
    expect(r.normName).toBe('aceite girasol canuelas');
    expect(r.tokens).toContain('aceite');
  });

  it('extrae unidad kg con formato "x 1 kg"', () => {
    const r = normalizeDescription('Arroz Gallo Oro x 1 kg');
    expect(r.unitAmount).toBe(1);
    expect(r.unitType).toBe('kg');
  });

  it('extrae kg desde "x1K" de Golopolis', () => {
    const r = normalizeDescription('AMANDA FORTUNA x1K');
    expect(r.unitAmount).toBe(1);
    expect(r.unitType).toBe('kg');
    expect(r.normName).toBe('amanda fortuna');
  });

  it('extrae gramos con coma decimal', () => {
    const r = normalizeDescription('Yerba Playadito 500 gr');
    expect(r.unitAmount).toBe(500);
    expect(r.unitType).toBe('g');
  });

  it('mapea alias lt/litro a litros', () => {
    expect(normalizeDescription('Gaseosa Coca Cola 1.5 lt').unitType).toBe('l');
    expect(normalizeDescription('Aceite girasol 900 ml').unitType).toBe('ml');
  });

  it('elimina stopwords y cantidades sueltas del nombre', () => {
    const r = normalizeDescription('Pañales de Bebé Etapa 2 x 40 unidades');
    expect(r.tokens).not.toContain('de');
    expect(r.normName).not.toContain(' 40 ');
    expect(r.unitType).toBe('un');
  });

  it('devuelve nulls cuando no hay unidad', () => {
    const r = normalizeDescription('Pan Lactal');
    expect(r.unitAmount).toBeNull();
    expect(r.unitType).toBeNull();
    expect(r.typeKeys).toEqual([]);
    expect(r.primaryType).toBeNull();
  });

  it('detecta el tipo de producto y evita la marca', () => {
    const r = normalizeDescription('Arroz Gallo Oro x 1 kg');
    expect(r.typeKeys).toContain('arroz');
    expect(r.primaryType).toBe('arroz');
    expect(r.brand).toBe('gallo');
  });

  it('detecta harina como tipo distinto de arroz', () => {
    const r = normalizeDescription('HARINA INTEGRAL 1 kg');
    expect(r.primaryType).toBe('harina');
    expect(r.typeKeys).not.toContain('arroz');
  });

  it('usar marca declarada por la fuente', () => {
    const r = normalizeDescription('Mayonesa Liviana Doypack', { brand: 'Hellmanns' });
    expect(r.brand).toBe('hellmanns');
    expect(r.brandProvided).toBe(true);
    expect(r.primaryType).toBe('mayonesa');
  });

  it('usa la descripción como contexto para el tipo', () => {
    const r = normalizeDescription('Fortuna Premium', { description: 'Arroz largo fino x 1 kg' });
    expect(r.typeKeys).toContain('arroz');
  });

  it('detecta tipos legítimos compartidos (chocolate con leche)', () => {
    const r = normalizeDescription('Chocolate con leche 200 gr');
    expect(r.typeKeys).toContain('chocolate');
    expect(r.typeKeys).toContain('leche');
  });
});
