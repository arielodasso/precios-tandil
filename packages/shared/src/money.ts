export function parsePrice(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null;
    return Math.round(input * 100) / 100;
  }
  let s = input.replace(/[^\d.,-]/g, '').trim();
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function formatArs(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}
