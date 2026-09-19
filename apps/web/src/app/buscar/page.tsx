import type { Metadata } from 'next';
import { ProductCard } from '@/components/ProductCard';
import { BackButton } from '@/components/BackButton';
import { Pagination } from '@/components/Pagination';
import { SortBar, type SortOption } from '@/components/SortBar';
import { cachedSearch } from '@/lib/queries/cached';
import type { SearchResultItem } from '@/lib/queries/search';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Buscar productos',
  description: 'Buscá productos y compará precios entre los supermercados de Tandil.',
  alternates: { canonical: '/buscar' },
  robots: { index: false, follow: true },
};

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const rawQ = Array.isArray(query.q) ? query.q[0] : query.q;
  const q = (rawQ ?? '').trim();
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const rawSort = Array.isArray(query.sort) ? query.sort[0] : query.sort;
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);
  const sort: SortOption =
    rawSort === 'az' || rawSort === 'za' || rawSort === 'price_asc' || rawSort === 'price_desc'
      ? rawSort
      : 'relevance';

  const items: SearchResultItem[] = [];
  let totalPages = 1;

  if (q.length >= 2 && q.length <= 64) {
    try {
      const results = await cachedSearch(q, page, sort);
      items.push(...results.items);
      totalPages = results.totalPages;
    } catch {
      totalPages = 1;
    }
  }

  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (sort !== 'relevance') qs.set('sort', sort);
  const pageHref = (p: number) => {
    const params = new URLSearchParams(qs);
    params.set('page', String(p));
    return `/buscar?${params.toString()}`;
  };
  const sortHref = (s: SortOption) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (s !== 'relevance') params.set('sort', s);
    return `/buscar?${params.toString()}`;
  };

  return (
    <div className="py-6">
      <div className="mb-6 flex items-center gap-3">
        <BackButton />
        <h1 className="text-2xl font-bold">Buscar productos</h1>
      </div>
      {!q && (
        <p className="mb-6 text-sm text-muted-foreground">
          Ingresá un término para buscar en todos los productos.
        </p>
      )}

      <form method="get" action="/buscar" className="mb-8">
        <div className="flex gap-2">
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar producto…"
            aria-label="Buscar producto"
          />
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </div>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q
            ? 'No se encontraron productos para esa búsqueda. Probá con otro término o el nombre de la marca.'
            : 'Escribí un término arriba para empezar a buscar.'}
        </p>
      ) : (
        <>
          <SortBar current={sort} href={sortHref} className="mb-6" />
          <ul className="grid grid-cols-1 gap-3">
            {items.map((p) => (
              <li key={p.slug}>
                <ProductCard
                  product={{
                    slug: p.slug,
                    name: p.name,
                    brand: p.brand,
                    unit: p.unit,
                    best_price: p.best_price,
                    stores_count: p.stores_count,
                    image_url: p.image_url,
                    offers: p.offers,
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} href={pageHref} />}
    </div>
  );
}
