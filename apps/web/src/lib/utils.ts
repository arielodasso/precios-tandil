import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ProductUnit } from '@/lib/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Quita los acentos (y la "ñ" → "n") de un texto. Se usa del lado de
 * búsqueda porque los nombres canónicos se guardan sin acentos; así
 * "cañuelas" también matchea contra "canuelas".
 */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Formatea la unidad de un producto para mostrar en la UI.
 * "1 kg", "500 ml", "6 uds", etc.
 */
export function formatUnit(unit: ProductUnit | null | undefined): string | null {
  if (!unit) return null;
  const typeLabels: Record<string, string> = {
    kg: 'kg',
    g: 'g',
    l: 'L',
    ml: 'ml',
    un: 'uds',
  };
  const displayType = typeLabels[unit.type] ?? unit.type;
  return `${unit.amount} ${displayType}`;
}

/**
 * Normaliza el nombre de un producto para mostrarlo en la UI.
 * Los nombres canónicos se guardan en minúsculas; acá se capitalizan
 * de forma legible ("arroz gallo oro 1kg" → "Arroz Gallo Oro 1kg")
 * sin alterar tokens numéricos/de unidad ni marcas en mayúsculas.
 */
export function titleCase(name: string): string {
  return name
    .split(/\s+/)
    .map((token) => {
      if (token.length === 0) return token;
      if (/\d/.test(token)) return token;
      if (/^[A-ZÁÉÍÓÚÑÜ]{2,}$/.test(token) && token.length > 2) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ');
}
