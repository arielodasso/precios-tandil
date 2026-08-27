import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
