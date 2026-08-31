export const STORE_SLUGS = [
  'carrefour',
  'monarca',
  'comerciante-maxi',
  'dia',
  'cooperativa-obrera',
  'vea',
  'golopolis',
] as const;

export type StoreSlug = (typeof STORE_SLUGS)[number];

export interface StoreInfo {
  slug: StoreSlug;
  name: string;
  baseUrl: string;
}

export const STORES: StoreInfo[] = [
  { slug: 'carrefour', name: 'Carrefour', baseUrl: 'https://www.carrefour.com.ar/' },
  { slug: 'monarca', name: 'Monarca', baseUrl: 'https://web.monarcadigital.com.ar/' },
  {
    slug: 'comerciante-maxi',
    name: 'Carrefour Maxi (Comerciante)',
    baseUrl: 'https://comerciante.carrefour.com.ar/',
  },
  { slug: 'dia', name: 'DIA', baseUrl: 'https://diaonline.supermercadosdia.com.ar/' },
  {
    slug: 'cooperativa-obrera',
    name: 'Cooperativa Obrera',
    baseUrl: 'https://www.cooperativaobrera.coop/',
  },
  { slug: 'vea', name: 'Vea', baseUrl: 'https://www.vea.com.ar/' },
  { slug: 'golopolis', name: 'Golopolis', baseUrl: 'https://www.golopolis.com.ar/' },
];

export interface StoreConfig {
  maxConcurrent?: number;
  delayMs?: [number, number];
  proxyPool?: string;
  extraHosts?: string[];
  consecutiveFailures?: number;
  quarantinedUntil?: string | null;
}
