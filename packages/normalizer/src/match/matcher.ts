import type { NormalizedProduct } from '../clean/normalize.ts';

export interface MatchCandidate {
  productId: number;
  ean: string | null;
  normName: string;
  unitAmount: number | null;
  unitType: string | null;
}

export type MatchOutcome =
  | { method: 'ean'; productId: number; score: number }
  | { method: 'semantic'; productId: number; score: number }
  | { method: 'none'; bestScore: number; bestCandidateId: number | null };

export interface MatchOptions {
  autoThreshold?: number;
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

export function semanticScore(norm: NormalizedProduct, cand: MatchCandidate): number {
  let score = diceSimilarity(norm.normName, cand.normName);

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

  return Math.round(score * 10_000) / 10_000;
}

export function matchByEan(ean: string | undefined, candidates: MatchCandidate[]): number | null {
  if (!ean) return null;
  return candidates.find((c) => c.ean === ean)?.productId ?? null;
}

export function findBestMatch(
  norm: NormalizedProduct,
  ean: string | undefined,
  candidates: MatchCandidate[],
  opts: MatchOptions = {},
): MatchOutcome {
  const autoThreshold = opts.autoThreshold ?? 0.82;

  const eanHit = matchByEan(ean, candidates);
  if (eanHit !== null) {
    return { method: 'ean', productId: eanHit, score: 1 };
  }

  let bestScore = 0;
  let bestCandidateId: number | null = null;
  for (const cand of candidates) {
    const score = semanticScore(norm, cand);
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
