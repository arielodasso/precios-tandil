import { pctChange } from '../money.ts';

export interface PricePoint {
  priceAmount: number;
  capturedAt: Date;
  isSuspect: boolean;
}

export function minInWindow(points: PricePoint[], windowDays: number, now: Date): number | null {
  const floor = now.getTime() - windowDays * 24 * 3_600_000;
  let min: number | null = null;
  for (const p of points) {
    if (p.isSuspect) continue;
    if (p.capturedAt.getTime() < floor || p.capturedAt.getTime() > now.getTime()) continue;
    if (min === null || p.priceAmount < min) min = p.priceAmount;
  }
  return min;
}

export function avgInWindow(points: PricePoint[], windowDays: number, now: Date): number | null {
  const floor = now.getTime() - windowDays * 24 * 3_600_000;
  let sum = 0;
  let count = 0;
  for (const p of points) {
    if (p.isSuspect) continue;
    if (p.capturedAt.getTime() < floor || p.capturedAt.getTime() > now.getTime()) continue;
    sum += p.priceAmount;
    count += 1;
  }
  return count === 0 ? null : roundTo(sum / count, 2);
}

export function allTimeMin(points: PricePoint[]): number | null {
  let min: number | null = null;
  for (const p of points) {
    if (p.isSuspect) continue;
    if (min === null || p.priceAmount < min) min = p.priceAmount;
  }
  return min;
}

export function nearMin90(bestPrice: number, min90: number | null): boolean {
  return min90 !== null && bestPrice <= min90 * 1.05;
}

export function hasEnoughHistory(points: PricePoint[], now: Date): boolean {
  const valid = points.filter((p) => !p.isSuspect);
  if (valid.length === 0) return false;
  const earliest = Math.min(...valid.map((p) => p.capturedAt.getTime()));
  return now.getTime() - earliest >= 7 * 24 * 3_600_000;
}

export function referencePriceBefore(
  points: PricePoint[],
  hoursAgo: number,
  now: Date,
): number | null {
  const threshold = now.getTime() - hoursAgo * 3_600_000;
  let ref: PricePoint | null = null;
  for (const p of points) {
    if (p.isSuspect) continue;
    if (p.capturedAt.getTime() > threshold) continue;
    if (ref === null || p.capturedAt.getTime() > ref.capturedAt.getTime()) ref = p;
  }
  return ref?.priceAmount ?? null;
}

export interface HistoryStatsInput {
  currentBest: number | null;
  points: PricePoint[];
  now: Date;
}

export interface HistoryStats {
  min30d: number | null;
  min90d: number | null;
  minAllTime: number | null;
  avg30d: number | null;
  pctChange24h: number | null;
  pctChange7d: number | null;
  enoughHistory: boolean;
}

export function computeHistoryStats(input: HistoryStatsInput): HistoryStats {
  const { currentBest, points, now } = input;
  const ref24h = referencePriceBefore(points, 24, now);
  const ref7d = referencePriceBefore(points, 24 * 7, now);
  return {
    min30d: minInWindow(points, 30, now),
    min90d: minInWindow(points, 90, now),
    minAllTime: allTimeMin(points),
    avg30d: avgInWindow(points, 30, now),
    pctChange24h: currentBest === null || ref24h === null ? null : pctChange(currentBest, ref24h),
    pctChange7d: currentBest === null || ref7d === null ? null : pctChange(currentBest, ref7d),
    enoughHistory: hasEnoughHistory(points, now),
  };
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
