import { describe, expect, it } from 'vitest';
import {
  CROSS_STORE_OUTLIER_RATIO,
  CROSS_STORE_REF_MIN_PRICE,
  isCrossStoreOutlier,
} from './cross-store-outlier.ts';

describe('isCrossStoreOutlier', () => {
  it('maraca como sospechoso un precio muy bajo respecto de la mediana cross-store', () => {
    expect(isCrossStoreOutlier(79_920, 1_289_999)).toBe(true);
  });

  it('marca como sospechoso un precio muy alto respecto de la mediana cross-store', () => {
    expect(isCrossStoreOutlier(8_000_000, 1_289_999)).toBe(true);
  });

  it('no marca precios dentro del rango razonable', () => {
    expect(isCrossStoreOutlier(300_000, 290_000)).toBe(false);
    expect(isCrossStoreOutlier(1_289_999, 79_921)).toBe(false);
  });

  it('no marca productos baratos aunque difieran mucho (la mediana baja es ruido normal)', () => {
    expect(isCrossStoreOutlier(5_690, 125_622)).toBe(false);
  });

  it('no marca cuando no hay referencia cross-store', () => {
    expect(isCrossStoreOutlier(79_920, null)).toBe(false);
  });

  it('exactamente en el límite del ratio no marca (necesita superarlo)', () => {
    expect(
      isCrossStoreOutlier(
        CROSS_STORE_REF_MIN_PRICE * CROSS_STORE_OUTLIER_RATIO,
        CROSS_STORE_REF_MIN_PRICE,
      ),
    ).toBe(false);
    expect(
      isCrossStoreOutlier(
        CROSS_STORE_REF_MIN_PRICE + 1,
        CROSS_STORE_REF_MIN_PRICE * CROSS_STORE_OUTLIER_RATIO,
      ),
    ).toBe(false);
  });

  it('mediana de referencia en el piso: una desviación del ratio no es suficiente', () => {
    expect(
      isCrossStoreOutlier(
        CROSS_STORE_REF_MIN_PRICE / CROSS_STORE_OUTLIER_RATIO,
        CROSS_STORE_REF_MIN_PRICE,
      ),
    ).toBe(false);
    expect(
      isCrossStoreOutlier(
        CROSS_STORE_REF_MIN_PRICE / CROSS_STORE_OUTLIER_RATIO - 1,
        CROSS_STORE_REF_MIN_PRICE,
      ),
    ).toBe(true);
  });
});
