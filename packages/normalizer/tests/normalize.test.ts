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
    expect(r.brand).toBe('arroz');
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
  });
});
