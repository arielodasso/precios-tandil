import { productSnapshotSchema, type ProductSnapshot } from '@precios/shared';

export type RejectionReason =
  | 'invalid_snapshot'
  | 'invalid_price'
  | 'invalid_currency'
  | 'invalid_source_url'
  | 'below_min_price'
  | 'single_source';

export interface ValidationOptions {
  allowedHosts: string[];
}

export type ValidationResult =
  | { ok: true; value: ProductSnapshot; warnings: string[] }
  | { ok: false; reason: RejectionReason; issues: string[] };

/** Precio mínimo de venta al público (ARS) para aceptar un snapshot. */
export const MIN_SHELF_PRICE = 500;

export function isValidEan13(ean: string): boolean {
  if (!/^\d{13}$/.test(ean)) return false;
  const digits = ean.split('').map(Number);
  const checksum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (checksum % 10)) % 10 === digits[12];
}

function hostAllowed(url: URL, allowedHosts: string[]): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function validateSnapshot(raw: unknown, opts: ValidationOptions): ValidationResult {
  const parsed = productSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_snapshot',
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  const snap = parsed.data;
  const warnings: string[] = [];

  if (!(snap.price.amount > 0) || !Number.isFinite(snap.price.amount)) {
    return { ok: false, reason: 'invalid_price', issues: [`amount=${snap.price.amount}`] };
  }

  if (snap.price.amount < MIN_SHELF_PRICE) {
    return {
      ok: false,
      reason: 'below_min_price',
      issues: [`amount=${snap.price.amount} < ${MIN_SHELF_PRICE}`],
    };
  }

  let url: URL;
  try {
    url = new URL(snap.url);
  } catch {
    return { ok: false, reason: 'invalid_source_url', issues: [`url=${snap.url}`] };
  }
  if (!hostAllowed(url, opts.allowedHosts)) {
    return {
      ok: false,
      reason: 'invalid_source_url',
      issues: [`host ${url.hostname} fuera del dominio de la tienda`],
    };
  }

  if (snap.ean && !isValidEan13(snap.ean)) {
    warnings.push(`ean ${snap.ean} con checksum inválido — se descarta el EAN`);
    delete snap.ean;
  }

  return { ok: true, value: snap, warnings };
}
