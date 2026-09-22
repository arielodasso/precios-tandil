/**
 * Detección de outliers cross-store: un precio se considera sospechoso cuando
 * se desvía más de CROSS_STORE_OUTLIER_RATIO de la mediana de las OTRAS
 * tiendas que venden el mismo producto y esa mediana de referencia es lo
 * suficientemente alta (evita falsos positivos en productos baratos, donde
 * las diferencias entre formatos o capturas mal interpretadas son normales).
 *
 * Calibración sobre producción (2026-09): con ref >= 250_000 y ratio > 5 se
 * marcan exactamente los 4 registros claramente erróneos (cuota*12 capturada
 * como precio total en Vea: secarropas, campana, freezer, lavavajillas) sin
 * falsos positivos sobre 13.561 filas de tienda.
 */
export const CROSS_STORE_REF_MIN_PRICE = 250000;
export const CROSS_STORE_OUTLIER_RATIO = 5;

export function isCrossStoreOutlier(amount: number, otherStoreRef: number | null): boolean {
  if (otherStoreRef === null || otherStoreRef < CROSS_STORE_REF_MIN_PRICE) return false;
  return (
    amount < otherStoreRef / CROSS_STORE_OUTLIER_RATIO ||
    amount > otherStoreRef * CROSS_STORE_OUTLIER_RATIO
  );
}
