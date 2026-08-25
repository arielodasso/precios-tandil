import type { MetadataRoute } from 'next';

/**
 * T071 — Sitemap dinámico: home, ofertas y todos los productos activos.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.SITE_BASE_URL ?? 'https://preciostandil.ar';
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api/v1';

  const entries: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${baseUrl}/ofertas`, changeFrequency: 'hourly', priority: 0.9 },
  ];

  try {
    const res = await fetch(`${apiBase}/search?q=&limit=20`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = (await res.json()) as { hits: Array<{ slug: string }> };
      for (const hit of data.hits ?? []) {
        entries.push({
          url: `${baseUrl}/p/${hit.slug}`,
          changeFrequency: 'daily',
          priority: 0.7,
        });
      }
    }
  } catch {
    // API caída: sitemap parcial
  }

  return entries;
}
