import { describe, expect, it } from 'vitest';
import { aggregatePackInfo, normalizeDescription } from '../src/clean/normalize.ts';

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

describe('detectPackInfo', () => {
  it('detecta x-pack con "N x M unidad" (6x710ml)', () => {
    const r = normalizeDescription('CERVEZA LATA HEINEKEN SIX PACK 6x710ml');
    expect(r.isPack).toBe(true);
    expect(r.unitCount).toBe(6);
  });

  it('detecta cantidad de unidades "x 40 unidades"', () => {
    const r = normalizeDescription('Pañales de Bebé Etapa 2 x 40 unidades');
    expect(r.isPack).toBe(true);
    expect(r.unitCount).toBe(40);
  });

  it('detecta "pack x 6" sin medida', () => {
    const r = normalizeDescription('Cerveza Heineken pack x 6');
    expect(r.isPack).toBe(true);
    expect(r.unitCount).toBe(6);
  });

  it('detecta "pack" suelto sin cantidad', () => {
    const r = normalizeDescription('Cerveza Quilmes pack');
    expect(r.isPack).toBe(true);
    expect(r.unitCount).toBeNull();
  });

  it('detecta "pack 6" con cantidad sin medida', () => {
    const r = normalizeDescription('PORRON STOUT PACK 6 300ml');
    expect(r.isPack).toBe(true);
    expect(r.unitCount).toBe(6);
  });

  it('NO trata cantidades de un solo artículo como pack', () => {
    expect(normalizeDescription('AMANDA FORTUNA x1K').isPack).toBe(false);
    expect(normalizeDescription('Hamburguesas x500g').isPack).toBe(false);
    expect(normalizeDescription('Polenta x750').isPack).toBe(false);
    expect(normalizeDescription('Lavandina x 1 lt').isPack).toBe(false);
  });

  it('NO marca doypack/flexpack como pack', () => {
    expect(normalizeDescription('Mayonesa Liviana Doypack').isPack).toBe(false);
    expect(normalizeDescription('Detergente Concentrado Flexpack').isPack).toBe(false);
  });

  it('una sola unidad "x1 un" es single, no pack', () => {
    const r = normalizeDescription('Salvado de Trigo x1 un');
    expect(r.isPack).toBe(false);
    expect(r.unitCount).toBe(1);
  });

  it('NO interpreta cadenas de dimensiones como pack (alto x ancho x prof)', () => {
    const a = normalizeDescription('Heladera 5.4 x 59 x 51 cm', {
      description: 'Dimensiones (alto x ancho x prof): 5.4 x 59 x 51 cm',
    });
    expect(a.isPack).toBe(false);
    const b = normalizeDescription('Cocina inoxidable', {
      description: 'Dimensiones con embalaje: 12 x 67 x 60 cm',
    });
    expect(b.isPack).toBe(false);
  });
});

describe('aggregatePackInfo', () => {
  it('elige la presentación de pack modal entre los SKUs', () => {
    const pack = aggregatePackInfo([
      'Pañales Babysec Ultrasoft P 12 uni',
      'Pañales Babysec ultrasoft p 12uni 12 uni',
      'Pañales Babysec Ultrasoft G 8uni 8 uni',
    ]);
    expect(pack.isPack).toBe(true);
    expect(pack.count).toBe(12);
  });

  it('preserva el pack cuando hay un solo SKU de pack y el resto sueltos', () => {
    const pack = aggregatePackInfo([
      'Cerveza Rubia Heineken Lata 710cm3 710 cm3',
      'Cerveza Lata Heineken Six Pack 6x710ml',
    ]);
    expect(pack.isPack).toBe(true);
    expect(pack.count).toBe(6);
  });

  it('devuelve desconocido sin evidencia de pack', () => {
    const pack = aggregatePackInfo([
      'Agua Mineral Sin Gas 2250 Ml Villa del Sur',
      'Lavarropas Whirlpool 9kg - 1400rpm',
    ]);
    expect(pack.isPack).toBe(false);
    expect(pack.count).toBeNull();
  });

  it('usa el fallback (nombre canónico) cuando no hay SKUs', () => {
    const pack = aggregatePackInfo([], 'Cerveza Heineken Six Pack 6x710ml');
    expect(pack.isPack).toBe(true);
    expect(pack.count).toBe(6);
  });
});
