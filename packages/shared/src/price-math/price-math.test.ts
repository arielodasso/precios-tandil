import { describe, expect, it } from 'vitest';
import { pctChange } from '../money.ts';
import {
  avgInWindow,
  computeHistoryStats,
  hasEnoughHistory,
  minInWindow,
  nearMin90,
  referencePriceBefore,
  type PricePoint,
} from './price-math.ts';

const NOW = new Date('2026-08-24T12:00:00.000Z');
const HORA = 3_600_000;
const DIA = 24 * HORA;

const point = (price: number, daysAgo: number, suspect = false): PricePoint => ({
  priceAmount: price,
  capturedAt: new Date(NOW.getTime() - daysAgo * DIA),
  isSuspect: suspect,
});

describe('pctChange (money.ts)', () => {
  it('calcula variación porcentual con 2 decimales', () => {
    expect(pctChange(1500, 2000)).toBe(-25);
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(1899, 1590)).toBe(19.43);
  });

  it('devuelve null con previo inválido', () => {
    expect(pctChange(1500, 0)).toBeNull();
  });
});

describe('minInWindow', () => {
  it('excluye suspects y puntos fuera de la ventana', () => {
    const points = [point(1500, 1), point(1200, 2, true), point(1400, 40), point(1600, 10)];
    expect(minInWindow(points, 30, NOW)).toBe(1500);
    expect(minInWindow(points, 7, NOW)).toBe(1500);
    expect(minInWindow(points, 90, NOW)).toBe(1400);
  });

  it('devuelve null si no hay datos válidos en la ventana', () => {
    expect(minInWindow([point(100, 60)], 30, NOW)).toBeNull();
    expect(minInWindow([], 30, NOW)).toBeNull();
    expect(minInWindow([point(100, 5, true)], 30, NOW)).toBeNull();
  });
});

describe('avgInWindow', () => {
  it('promedia solo válidos dentro de la ventana', () => {
    const points = [point(1000, 1), point(2000, 2), point(9999, 2, true), point(5000, 45)];
    expect(avgInWindow(points, 30, NOW)).toBe(1500);
  });

  it('null con ventana vacía o todo suspect', () => {
    expect(avgInWindow([], 30, NOW)).toBeNull();
    expect(avgInWindow([point(10, 1, true)], 30, NOW)).toBeNull();
  });
});

describe('nearMin90', () => {
  it('verdadero dentro del 5% del mínimo de 90 días', () => {
    expect(nearMin90(1050, 1000)).toBe(true);
    expect(nearMin90(1051, 1000)).toBe(false);
    expect(nearMin90(950, 1000)).toBe(true);
  });

  it('falso sin mínimo conocido', () => {
    expect(nearMin90(1000, null)).toBe(false);
  });
});

describe('hasEnoughHistory', () => {
  it('exige al menos 7 días de datos válidos', () => {
    expect(hasEnoughHistory([point(100, 6)], NOW)).toBe(false);
    expect(hasEnoughHistory([point(100, 8)], NOW)).toBe(true);
    expect(hasEnoughHistory([point(100, 2, true), point(100, 8)], NOW)).toBe(true);
    expect(hasEnoughHistory([point(100, 2, true)], NOW)).toBe(false);
    expect(hasEnoughHistory([], NOW)).toBe(false);
  });
});

describe('referencePriceBefore', () => {
  it('toma el último precio válido anterior a las N horas', () => {
    const points = [
      { priceAmount: 2000, capturedAt: new Date(NOW.getTime() - 50 * HORA), isSuspect: false },
      { priceAmount: 1800, capturedAt: new Date(NOW.getTime() - 30 * HORA), isSuspect: false },
      { priceAmount: 1700, capturedAt: new Date(NOW.getTime() - 25 * HORA), isSuspect: false },
      { priceAmount: 1, capturedAt: new Date(NOW.getTime() - 26 * HORA), isSuspect: true },
    ];
    expect(referencePriceBefore(points, 24, NOW)).toBe(1700);
    expect(referencePriceBefore(points, 48, NOW)).toBe(2000);
    expect(referencePriceBefore([], 24, NOW)).toBeNull();
  });
});

describe('computeHistoryStats', () => {
  it('integra mínimos, promedios y variaciones excluyendo suspects', () => {
    const points = [point(2000, 10), point(1600, 3), point(1200, 0.5, true), point(1500, 0.1)];
    const stats = computeHistoryStats({ currentBest: 1500, points, now: NOW });
    expect(stats.min30d).toBe(1500);
    expect(stats.minAllTime).toBe(1500);
    expect(stats.avg30d).toBeCloseTo(1700, 0);
    expect(stats.pctChange7d).toBe(-25);
    expect(stats.enoughHistory).toBe(true);
  });

  it('marca datos insuficientes con menos de 7 días', () => {
    const stats = computeHistoryStats({
      currentBest: 1500,
      points: [point(1500, 0.5)],
      now: NOW,
    });
    expect(stats.enoughHistory).toBe(false);
    expect(stats.min90d).toBe(1500);
  });

  it('variaciones null sin precio actual', () => {
    const stats = computeHistoryStats({ currentBest: null, points: [point(100, 20)], now: NOW });
    expect(stats.pctChange24h).toBeNull();
    expect(stats.pctChange7d).toBeNull();
  });
});
