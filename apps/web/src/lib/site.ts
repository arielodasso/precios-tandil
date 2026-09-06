export const SITE_BASE_URL =
  process.env.SITE_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://preciostandil.ar';

export const siteUrl = (path = '/'): string => {
  const base = SITE_BASE_URL.replace(/\/+$/, '');
  if (!path || path === '/') return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};
