import { describe, expect, it } from 'vitest';
import { normalizeDescription } from '../src/clean/normalize.ts';
import {
  diceSimilarity,
  findBestMatch,
  hammingDistance,
  isValidEan13,
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
    brand: 'gallo',
    brandProvided: true,
    typeKeys: ['arroz'],
    variantFlags: [],
    imageHash: '1111111111111111',
    imageUrl: 'https://img.example/arroz.jpg',
    contextText: '',
  },
  {
    productId: 2,
    ean: null,
    normName: 'arroz gallo oro',
    unitAmount: 1,
    unitType: 'kg',
    brand: 'gallo',
    brandProvided: true,
    typeKeys: ['arroz'],
    variantFlags: [],
    imageHash: null,
    imageUrl: null,
    contextText: '',
  },
  {
    productId: 3,
    ean: null,
    normName: 'arroz gallo oro',
    unitAmount: 500,
    unitType: 'g',
    brand: 'gallo',
    brandProvided: true,
    typeKeys: ['arroz'],
    variantFlags: [],
    imageHash: null,
    imageUrl: null,
    contextText: '',
  },
  {
    productId: 4,
    ean: null,
    normName: 'arroz parboil largo fino',
    unitAmount: 1,
    unitType: 'kg',
    brand: null,
    brandProvided: false,
    typeKeys: ['arroz'],
    variantFlags: [],
    imageHash: null,
    imageUrl: null,
    contextText: '',
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

  it('bloquea de forma dura el conflicto de tipos arroz vs harina', () => {
    const norm = normalizeDescription('Arroz Integral x 1 kg');
    const cand: MatchCandidate = {
      productId: 99,
      ean: null,
      normName: 'harina integral',
      unitAmount: 1,
      unitType: 'kg',
      brand: null,
      brandProvided: false,
      typeKeys: ['harina'],
      variantFlags: [],
      imageHash: null,
      imageUrl: null,
      contextText: '',
    };
    const score = semanticScore(norm, cand);
    expect(score).toBeLessThan(0.2);
    const res = findBestMatch(norm, undefined, [cand]);
    expect(res.method).toBe('none');
  });

  it('no bloquea tipos con intersección legítima (chocolate con leche)', () => {
    const norm = normalizeDescription('Chocolate con leche 200 gr');
    const cand: MatchCandidate = {
      productId: 98,
      ean: null,
      normName: 'chocolate con leche',
      unitAmount: 200,
      unitType: 'g',
      brand: null,
      brandProvided: false,
      typeKeys: ['chocolate', 'leche'],
      variantFlags: [],
      imageHash: null,
      imageUrl: null,
      contextText: '',
    };
    expect(semanticScore(norm, cand)).toBeGreaterThan(0.8);
  });

  it('favorece marca declarada coincidente', () => {
    const conGallo = normalizeDescription('Arroz Largo Fino Premium x 1 kg', { brand: 'gallo' });
    const conOtra = normalizeDescription('Arroz Largo Fino Premium x 1 kg', { brand: 'vea' });
    const cand: MatchCandidate = {
      productId: 97,
      ean: null,
      normName: 'arroz largo fino premium paquete',
      unitAmount: 1,
      unitType: 'kg',
      brand: 'gallo',
      brandProvided: true,
      typeKeys: ['arroz'],
      variantFlags: [],
      imageHash: null,
      imageUrl: null,
      contextText: '',
    };
    expect(semanticScore(conGallo, cand)).toBeGreaterThan(semanticScore(conOtra, cand));
  });

  it('penaliza fuertemente marcas declaradas distintas', () => {
    const noel = normalizeDescription('Polenta Noel Instantanea x 500g', { brand: 'noel' });
    const coop = normalizeDescription('Polenta Cooperativa Instantanea 500grs', {
      brand: 'cooperativa',
    });
    const cand: MatchCandidate = {
      productId: 88,
      ean: null,
      normName: 'polenta noel instantanea',
      unitAmount: 500,
      unitType: 'g',
      brand: 'noel',
      brandProvided: true,
      typeKeys: ['legumbre'],
      variantFlags: [],
      imageHash: null,
      imageUrl: null,
      contextText: '',
    };
    const scoreSame = semanticScore(noel, cand);
    const scoreDiff = semanticScore(coop, cand);
    expect(scoreDiff).toBeLessThan(scoreSame);
    expect(scoreDiff).toBeLessThan(0.5);
  });

  it('penaliza fuertemente imágenes dispares', () => {
    const norm = normalizeDescription('Arroz Integral x 1 kg');
    const sameImg = semanticScore(norm, candidates[0]!, {
      incomingImageHash: '1111111111111111',
    });
    const diffImg = semanticScore(norm, candidates[0]!, {
      incomingImageHash: 'ffffffffffffffff',
    });
    expect(diffImg).toBeLessThan(sameImg);
  });
});

describe('hammingDistance', () => {
  it('calcula distancia de Hamming entre hashes hex', () => {
    expect(hammingDistance('0', '0')).toBe(0);
    expect(hammingDistance('0', 'f')).toBe(4);
  });
});

describe('diceSimilarity', () => {
  it('idénticos = 1, vacíos = 0', () => {
    expect(diceSimilarity('arroz', 'arroz')).toBe(1);
    expect(diceSimilarity('', 'arroz')).toBe(0);
  });
});

describe('isValidEan13', () => {
  it('valida checksum correcto', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('7791234567898')).toBe(true);
  });

  it('rechaza checksum inválido o largo distinto', () => {
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('123456789012')).toBe(false);
    expect(isValidEan13(null)).toBe(false);
    expect(isValidEan13('')).toBe(false);
  });
});

describe('findBestMatch', () => {
  it('prioriza EAN sobre semántico', () => {
    const norm = normalizeDescription('Arroz Gallo Oro x 1 kg');
    const res = findBestMatch(norm, '7791234567898', candidates);
    expect(res.method).toBe('ean');
    if (res.method === 'ean') expect(res.productId).toBe(1);
  });

  it('con EAN compartido por varios productos elige el más parecido', () => {
    const dupes: MatchCandidate[] = [
      { ...candidates[0]!, ean: '7799999999999' },
      { ...candidates[3]!, ean: '7799999999999', productId: 5 },
    ];
    const norm = normalizeDescription('Arroz Gallo Oro x 1 kg');
    const res = findBestMatch(norm, '7799999999999', dupes);
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

  it('no auto-matchea variantes distintas con misma marca (Max vs Fresh), aunque compartan flag estructural', () => {
    const norm = normalizeDescription('Papel higienico Higienol Max hoja simple 100 mts 4 uni');
    const freshCand: MatchCandidate = {
      productId: 77,
      ean: null,
      normName: 'papel higienico higienol fresh hoja simple 120 mts',
      unitAmount: 4,
      unitType: 'un',
      brand: 'higienol',
      brandProvided: true,
      typeKeys: [],
      variantFlags: ['fresh', 'simple'],
      imageHash: null,
      imageUrl: null,
      contextText: '',
    };
    const res = findBestMatch(norm, undefined, [freshCand]);
    expect(res.method).toBe('none');
  });

  it('sí auto-matchea la MIA variante cuando comparte flags exclusivos (Max vs Max hoja simple)', () => {
    const norm = normalizeDescription('Papel higienico Higienol Max hoja simple 100 mts 4 uni');
    const maxCand: MatchCandidate = {
      productId: 78,
      ean: null,
      normName: 'papel higienico higienol max hoja simple 120 mts',
      unitAmount: 4,
      unitType: 'un',
      brand: 'higienol',
      brandProvided: true,
      typeKeys: [],
      variantFlags: ['max', 'simple'],
      imageHash: null,
      imageUrl: null,
      contextText: '',
    };
    const res = findBestMatch(norm, undefined, [maxCand]);
    expect(res.method).toBe('semantic');
    if (res.method === 'semantic') expect(res.productId).toBe(78);
  });

  it('descarta semántica candidatos con EAN válido y distinto al entrante', () => {
    const norm = normalizeDescription('Arroz Gallo Oro x 1 kg');
    const res = findBestMatch(norm, '4006381333931', [candidates[0]!]);
    expect(res.method).toBe('none');

    const resSinEan = findBestMatch(norm, undefined, [candidates[0]!]);
    expect(resSinEan.method).toBe('semantic');
  });
});
