import { describe, expect, it } from 'vitest';
import {
  decideDeal,
  DEAL_DISCOUNT_THRESHOLD,
  DEAL_MIN_STORES,
  DEAL_REJECT_COOLDOWN_DAYS,
  type DealCandidateInput,
} from './detect-deals.ts';

const NOW = new Date('2026-08-25T12:00:00Z');

function base(overrides: Partial<DealCandidateInput> = {}): DealCandidateInput {
  return {
    productId: 'prod-1',
    bestPrice: 850,
    avg30d: 1000,
    storesCount: 3,
    pendingOrPublished: false,
    rejectedUntil: null,
    ...overrides,
  };
}

describe('decideDeal', () => {
  it('detecta oportunidad válida (15% descuento, 2+ tiendas)', () => {
    const result = decideDeal(base(), NOW);
    expect(result).not.toBeNull();
    expect(result!.discountPct).toBe(15);
  });

  it('detecta descuento mayor con precisión correcta', () => {
    const result = decideDeal(base({ bestPrice: 500, avg30d: 1000 }), NOW);
    expect(result).not.toBeNull();
    expect(result!.discountPct).toBe(50);
  });

  it('rejecta cuando avg30d es null', () => {
    expect(decideDeal(base({ avg30d: null }), NOW)).toBeNull();
  });

  it('rejecta cuando avg30d es 0', () => {
    expect(decideDeal(base({ avg30d: 0 }), NOW)).toBeNull();
  });

  it('rejecta cuando avg30d es negativo', () => {
    expect(decideDeal(base({ avg30d: -100 }), NOW)).toBeNull();
  });

  it('rejecta cuando storesCount < 2', () => {
    expect(decideDeal(base({ storesCount: 1 }), NOW)).toBeNull();
  });

  it('acepta cuando storesCount es exactamente 2', () => {
    expect(decideDeal(base({ storesCount: 2 }), NOW)).not.toBeNull();
  });

  it('rejecta cuando ya hay candidato pendiente/publicado', () => {
    expect(decideDeal(base({ pendingOrPublished: true }), NOW)).toBeNull();
  });

  it('rejecta cuando bestPrice >= avg30d (sin descuento)', () => {
    expect(decideDeal(base({ bestPrice: 1000, avg30d: 1000 }), NOW)).toBeNull();
    expect(decideDeal(base({ bestPrice: 1100, avg30d: 1000 }), NOW)).toBeNull();
  });

  it('rejecta cuando descuento es menor al umbral (14.9%)', () => {
    const result = decideDeal(base({ bestPrice: 851, avg30d: 1000 }), NOW);
    expect(result).toBeNull();
  });

  it('acepta cuando descuento es justo el umbral (15%)', () => {
    const result = decideDeal(base({ bestPrice: 850, avg30d: 1000 }), NOW);
    expect(result).not.toBeNull();
  });

  it('rejecta candidato rechazado dentro del cooldown de 14 días', () => {
    const rejectedUntil = new Date(NOW.getTime() + 5 * 86_400_000);
    expect(decideDeal(base({ rejectedUntil }), NOW)).toBeNull();
  });

  it('acepta candidato rechazado cuyo cooldown ya expiró', () => {
    const rejectedUntil = new Date(NOW.getTime() - 1 * 86_400_000);
    expect(decideDeal(base({ rejectedUntil }), NOW)).not.toBeNull();
  });

  it('acepta candidato rechazado exactamente al final del cooldown', () => {
    const rejectedUntil = new Date(NOW.getTime() - DEAL_REJECT_COOLDOWN_DAYS * 86_400_000);
    expect(decideDeal(base({ rejectedUntil }), NOW)).not.toBeNull();
  });

  it('rejecta candidato rechazado con rejectedUntil en el futuro exacto', () => {
    const rejectedUntil = new Date(NOW.getTime() + 1);
    expect(decideDeal(base({ rejectedUntil }), NOW)).toBeNull();
  });

  it('redondea discountPct a 2 decimales', () => {
    const result = decideDeal(base({ bestPrice: 667, avg30d: 1000 }), NOW);
    expect(result).not.toBeNull();
    expect(result!.discountPct).toBe(33.3);
  });

  it('constants son consistentes con la spec', () => {
    expect(DEAL_DISCOUNT_THRESHOLD).toBe(0.15);
    expect(DEAL_MIN_STORES).toBe(2);
    expect(DEAL_REJECT_COOLDOWN_DAYS).toBe(14);
  });
});
