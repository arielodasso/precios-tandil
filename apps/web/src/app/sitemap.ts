import type { MetadataRoute } from 'next';
import { sql, type SqlBool } from 'kysely';
import { getDb } from '@/lib/db';
import { siteUrl } from '@/lib/site';

/** T071 — Sitemap dinámico: home, ofertas, categorías y TODOS los productos indexables. */
export const revalidate = 3600;

const CHUNK_SIZE = 1000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: siteUrl('/'), changeFrequency: 'daily', priority: 1 },
    { url: siteUrl('/ofertas'), changeFrequency: 'daily', priority: 0.9 },
    { url: siteUrl('/buscar'), changeFrequency: 'monthly', priority: 0.3 },
  ];

  try {
    const db = getDb();

    const categories = await db.selectFrom('category').select(['slug']).orderBy('slug').execute();
    for (const cat of categories) {
      entries.push({
        url: siteUrl(`/categoria/${cat.slug}`),
        changeFrequency: 'daily',
        priority: 0.7,
      });
    }

    let lastSlug: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const chunk = await db
        .selectFrom('product as p')
        .innerJoin('price_aggregate as pa', 'pa.product_id', 'p.id')
        .select(['p.slug'])
        .where('pa.stores_count', '>=', 2)
        .where(sql<SqlBool>`pa.best_price::numeric >= 500`)
        .$if(lastSlug !== undefined, (qb) => qb.where('p.slug', '>', lastSlug!))
        .orderBy('p.slug')
        .limit(CHUNK_SIZE)
        .execute();

      for (const p of chunk) {
        entries.push({ url: siteUrl(`/p/${p.slug}`), changeFrequency: 'daily', priority: 0.6 });
      }
      hasMore = chunk.length === CHUNK_SIZE;
      lastSlug = chunk[chunk.length - 1]?.slug;
    }
  } catch {
    // DB caída: sitemap parcial con páginas estáticas
  }

  return entries;
}
