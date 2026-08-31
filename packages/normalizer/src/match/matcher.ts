import type { NormalizedProduct } from '../clean/normalize.ts';

export interface MatchCandidate {
  productId: number;
  ean: string | null;
  normName: string;
  unitAmount: number | null;
  unitType: string | null;
  brand: string | null;
  brandProvided: boolean;
  typeKeys: string[];
  imageHash: string | null;
  imageUrl: string | null;
  contextText: string;
}

export type MatchOutcome =
  | { method: 'ean'; productId: number; score: number }
  | { method: 'semantic'; productId: number; score: number }
  | { method: 'none'; bestScore: number; bestCandidateId: number | null };

export interface MatchOptions {
  autoThreshold?: number;
  /** Hash perceptual de la imagen del snapshot entrante, para confirmar/descartar candidatos. */
  incomingImageHash?: string | null;
}

/** Distancia de Hamming entre dos hashes perceptuales hex (64 bits). */
export function hammingDistance(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < maxLen; i++) {
    const na = Number.parseInt(a[i] ?? '0', 16);
    const nb = Number.parseInt(b[i] ?? '0', 16);
    let x = na ^ nb;
    while (x > 0) {
      diff += x & 1;
      x >>= 1;
    }
  }
  return diff;
}

function bigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    map.set(bg, (map.get(bg) ?? 0) + 1);
  }
  return map;
}

export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let intersection = 0;
  let total = 0;
  for (const [, count] of ga) total += count;
  for (const [, count] of gb) total += count;
  for (const [bg, count] of ga) {
    const other = gb.get(bg) ?? 0;
    intersection += Math.min(count, other);
  }
  if (total === 0) return 0;
  return (2 * intersection) / total;
}

function containsTypeConflict(
  a: NormalizedProduct,
  b: MatchCandidate,
): { conflict: boolean; shared: string[] } {
  if (a.typeKeys.length === 0 || b.typeKeys.length === 0) return { conflict: false, shared: [] };
  const shared = a.typeKeys.filter((k) => b.typeKeys.includes(k));
  return { conflict: shared.length === 0, shared };
}

export function semanticScore(
  norm: NormalizedProduct,
  cand: MatchCandidate,
  opts: MatchOptions = {},
): number {
  let score = diceSimilarity(norm.normName, cand.normName);

  const contextRaw = `${norm.contextText}`;
  const candContext = extractBestContext(cand);
  if (contextRaw && candContext) {
    score = score * 0.75 + diceSimilarity(contextRaw, candContext) * 0.25;
  } else if (score > 0 && !norm.normName) {
    score = diceSimilarity(contextRaw, candContext ?? cand.normName);
  }

  const { conflict, shared } = containsTypeConflict(norm, cand);
  if (conflict) {
    // Bloqueo duro por tipo de producto distinto (p.ej. arroz vs harina).
    return Math.round(Math.min(score, 0.2) * 0.3 * 10_000) / 10_000;
  }

  const bothUnitsKnown =
    norm.unitType !== null &&
    norm.unitAmount !== null &&
    cand.unitType !== null &&
    cand.unitAmount !== null;

  if (bothUnitsKnown) {
    const sameUnit = norm.unitType === cand.unitType;
    const amountRatio =
      Math.min(norm.unitAmount!, cand.unitAmount!) / Math.max(norm.unitAmount!, cand.unitAmount!);
    if (!sameUnit) score *= 0.6;
    else if (amountRatio < 0.95) score *= 0.7;
    else score = Math.min(1, score * 1.05);
  }

  if (shared.length > 0 && norm.primaryType && norm.primaryType === cand.typeKeys[0]) {
    score = Math.min(1, score * 1.05);
  }

  if (norm.brandProvided && cand.brand && cand.brand === norm.brand) {
    score = Math.min(1, score * 1.04);
  }

  // Marcas declaradas (fuente) y distintas = productos distintos: penalizar
  // fuerte para no mezclar marca propia de supermercado con marca real.
  if (
    norm.brandProvided &&
    cand.brandProvided &&
    cand.brand &&
    norm.brand &&
    norm.brand !== cand.brand
  ) {
    score *= 0.4;
  }

  const normHash = opts.incomingImageHash ?? null;
  if (normHash && cand.imageHash) {
    const distance = hammingDistance(normHash, cand.imageHash);
    if (distance <= 5) score = Math.min(1, score * 1.05);
    else if (distance >= 32) score *= 0.5;
  }

  return Math.round(score * 10_000) / 10_000;
}

function extractBestContext(cand: MatchCandidate): string | null {
  return cand.contextText ?? null;
}

export function matchByEan(ean: string | undefined, candidates: MatchCandidate[]): number | null {
  if (!ean) return null;
  return candidates.find((c) => c.ean === ean)?.productId ?? null;
}

/** Checksum EAN-13 (misma lógica que @precios/scraper-core, sin dependencias). */
export function isValidEan13(ean: string | null): boolean {
  if (!ean || !/^\d{13}$/.test(ean)) return false;
  const digits = [...ean].map((d) => Number(d));
  const checksum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (checksum % 10)) % 10 === digits[12]!;
}

export function findBestMatch(
  norm: NormalizedProduct,
  ean: string | undefined,
  candidates: MatchCandidate[],
  opts: MatchOptions = {},
): MatchOutcome {
  const autoThreshold = opts.autoThreshold ?? 0.82;
  const incomingEanValid = isValidEan13(ean ?? null);

  if (ean) {
    const eanHits = candidates.filter((c) => c.ean === ean);
    if (eanHits.length === 1) {
      return { method: 'ean', productId: eanHits[0]!.productId, score: 1 };
    }
    if (eanHits.length > 1) {
      // Varios productos comparten EAN (duplicados históricos): elegir el más
      // parecido semánticamente para no alternar el producto canónico entre runs.
      let best: MatchCandidate | null = null;
      let bestScore = -1;
      for (const cand of eanHits) {
        const s = semanticScore(norm, cand, opts);
        if (s > bestScore) {
          bestScore = s;
          best = cand;
        }
      }
      if (best) return { method: 'ean', productId: best.productId, score: 1 };
    }
  }

  let bestScore = 0;
  let bestCandidateId: number | null = null;
  for (const cand of candidates) {
    // EANs válidos y distintos = productos distintos: no emparejar por semántica.
    if (incomingEanValid && cand.ean !== null && cand.ean !== ean && isValidEan13(cand.ean)) {
      continue;
    }
    const score = semanticScore(norm, cand, opts);
    if (score > bestScore) {
      bestScore = score;
      bestCandidateId = cand.productId;
    }
  }

  if (bestCandidateId !== null && bestScore >= autoThreshold) {
    return { method: 'semantic', productId: bestCandidateId, score: bestScore };
  }

  return { method: 'none', bestScore, bestCandidateId };
}
