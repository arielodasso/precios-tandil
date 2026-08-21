import type { UnitType } from '@precios/shared';

export interface NormalizedProduct {
  normName: string;
  tokens: string[];
  brand: string | null;
  unitAmount: number | null;
  unitType: UnitType | null;
}

const STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'y',
  'en',
  'con',
  'para',
  'por',
  'un',
  'una',
  'x',
]);

const UNIT_ALIASES: Record<string, UnitType> = {
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kgs: 'kg',
  g: 'g',
  gr: 'g',
  grs: 'g',
  gramo: 'g',
  gramos: 'g',
  l: 'l',
  lt: 'l',
  lts: 'l',
  litro: 'l',
  litros: 'l',
  ml: 'ml',
  cc: 'ml',
  un: 'un',
  unidad: 'un',
  unidades: 'un',
};

const UNIT_RE =
  /(\d+(?:[.,]\d+)?)\s*(kg|kilos?|kgs|g|grs?|gramos?|l|lts?|litros?|ml|cc|un|unidades?)\b/gi;

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeNumber(n: string): number {
  return Number.parseFloat(n.replace(',', '.'));
}

export function normalizeDescription(raw: string): NormalizedProduct {
  const accented = raw.toLowerCase();
  const clean = stripAccents(accented);

  let unitAmount: number | null = null;
  let unitType: UnitType | null = null;
  const quantityMatches = [...clean.matchAll(UNIT_RE)];
  if (quantityMatches.length > 0) {
    const last = quantityMatches[quantityMatches.length - 1]!;
    unitAmount = normalizeNumber(last[1]!);
    unitType = UNIT_ALIASES[last[2]!.toLowerCase()] ?? null;
  }

  const tokens = clean
    .replace(UNIT_RE, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+([.,]\d+)?$/.test(t));

  const brandToken = tokens.find((t) => /^[a-z]{3,}$/.test(t));
  const brand = brandToken ?? null;

  return {
    normName: tokens.join(' '),
    tokens,
    brand,
    unitAmount,
    unitType,
  };
}
