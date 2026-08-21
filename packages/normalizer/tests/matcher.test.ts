import { describe, expect, it } from 'vitest';
import { normalizeDescription } from '../src/clean/normalize.ts';
import {
  diceSimilarity,
  findBestMatch,
  matchByEan,
  semanticScore,
  type MatchCandidate,
} from '../src/match/matcher.ts';

const candidates: MatchCandidate[] = [
  {
    productId: 1,
    ean: '7791234567898',
    normName: 'arroz gallo oro',
    unitAmount: 1,
    unitType: 'kg',
  },
  {
    productId: 2,
    ean: null,
    normName: 'arroz gallo oro',
    unitAmount: 1,
    unitType: 'kg',
  },
  {
    productId: 3,
    ean: null,
    normName: 'arroz gallo oro',
    unitAmount: 500,
    unitType: 'g',
  },
  {
    productId: 4,
    ean: null,
    normName: 'arroz parboil largo fino',
    unitAmount: 1,
    unitType: 'kg',
  },
];

describe('matchByEan', () => {
  it('encuentra por EAN exacto', () => {
    expect(matchByEan('7791234567898', candidates)).toBe(1);
  });

  it('devuelve null sin EAN o sin candidato', () => {
    expect(matchByEan(undefined, candidates)).toBeNull();
    expect(matchByEan('0000000000000', candidates)).toBeNull();
  });
});

describe('semanticScore', () => {
  it('da score alto para nombres iguales con misma unidad', () => {
    const norm = normalizeDescription('Arroz Gallo Oro x 1 kg');
    const score = semanticScore(norm, candidates[0]!);
    expect(score).toBeGreaterThan(0.9);
  });

  it('penaliza unidades distintas', () => {
    const norm = normalizeDescription('Arroz Gallo Oro x 1 kg');
    const sameUnit = semanticScore(norm, candidates[0]!);
    const diffUnit = semanticScore(norm, candidates[2]!);
    expect(diffUnit).toBeLessThan(sameUnit);
  });
});

describe('diceSimilarity', () => {
  it('idénticos = 1, vacíos = 0', () => {
    expect(diceSimilarity('arroz', 'arroz')).toBe(1);
    expect(diceSimilarity('', 'arroz')).toBe(0);
  });
});

describe('findBestMatch', () => {
  it('prioriza EAN sobre semántico', () => {
    const norm = normalizeDescription('Arroz Gallo Oro x 1 kg');
    const res = findBestMatch(norm, '7791234567898', candidates);
    expect(res.method).toBe('ean');
    if (res.method === 'ean') expect(res.productId).toBe(1);
  });

  it('match semántico auto sobre umbral cuando nombre y unidad coinciden', () => {
    const norm = normalizeDescription('Arroz Gallo Oro x 1kg');
    const res = findBestMatch(
      norm,
      undefined,
      candidates.filter((c) => c.ean === null),
    );
    expect(res.method).toBe('semantic');
    if (res.method === 'semantic') expect(res.productId).toBe(2);
  });

  it('mismo nombre con tamaño distinto NO auto-matchea (penalización de unidad)', () => {
    const norm = normalizeDescription('Arroz Gallo Oro x 1 kg');
    const solo500g = [candidates[2]!];
    const res = findBestMatch(norm, undefined, solo500g);
    expect(res.method).toBe('none');
  });

  it('sin parecido devuelve none con mejor score bajo umbral', () => {
    const norm = normalizeDescription('Detergente Liquido Zorro');
    const res = findBestMatch(norm, undefined, candidates);
    expect(res.method).toBe('none');
    if (res.method === 'none') expect(res.bestScore).toBeLessThan(0.82);
  });
});
