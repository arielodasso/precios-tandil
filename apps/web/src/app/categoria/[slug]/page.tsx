import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getCategoryTree, type CategoryNode } from '@/lib/queries/categories';
import { listCategoryProducts } from '@/lib/queries/category-products';
import { ProductCard } from '@/components/ProductCard';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Categoría' };

const PAGE_SIZE = 10;

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);

  const db = getDb();

  const tree = await getCategoryTree(db);
  const match = findCategory(tree, slug);
  if (!match) notFound();

  const result = await listCategoryProducts(db, slug, { page, pageSize: PAGE_SIZE });

  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 1;
  const showPagination = total > PAGE_SIZE;

  return (
    <div className="py-6">
      <h1 className="mb-1 text-2xl font-bold">{match.name}</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {total > 0 ? `${total} productos` : 'Productos de la categoría'}
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay productos en esta categoría.</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((p) => (
            <li key={p.slug}>
              <ProductCard
                product={{
                  slug: p.slug,
                  name: p.name,
                  brand: p.brand,
                  best_price: p.best_price,
                  stores_count: p.stores_count,
                  image_url: p.image_url,
                  offers: p.offers,
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {showPagination && totalPages > 1 && (
        <nav aria-label="Paginación" className="mt-6 flex items-center justify-center gap-3">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/categoria/${slug}?page=${page - 1}`}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Anterior
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/categoria/${slug}?page=${page + 1}`}>Siguiente</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Siguiente
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}

function findCategory(nodes: CategoryNode[], slug: string): CategoryNode | undefined {
  for (const node of nodes) {
    if (node.slug === slug) return node;
    const child = findCategory(node.children, slug);
    if (child) return child;
  }
  return undefined;
}
