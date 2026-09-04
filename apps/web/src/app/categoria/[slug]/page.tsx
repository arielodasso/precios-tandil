import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getCategoryTree, type CategoryNode } from '@/lib/queries/categories';
import {
  listCategoryProducts,
  getCategorySummary,
  type CategorySummary,
} from '@/lib/queries/category-products';
import { ProductCard } from '@/components/ProductCard';
import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Categoría' };

const PAGE_SIZE = 10;

function formatArs(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value);
}

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
  const rawQ = Array.isArray(query.q) ? query.q[0] : query.q;
  const q = (rawQ ?? '').trim();
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);

  const db = getDb();

  const tree = await getCategoryTree(db);
  const match = findCategory(tree, slug);
  if (!match) notFound();

  const [summary, result] = await Promise.all([
    getCategorySummary(db, slug),
    listCategoryProducts(db, slug, { page, pageSize: PAGE_SIZE, q }),
  ]);

  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 1;
  const showPagination = total > PAGE_SIZE;

  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  const pageHref = (p: number) => {
    const params = new URLSearchParams(qs);
    params.set('page', String(p));
    return `/categoria/${slug}?${params.toString()}`;
  };

  return (
    <div className="py-6">
      <div className="mb-1 flex items-center gap-3">
        <BackButton />
        <h1 className="text-2xl font-bold">{match.name}</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        {q
          ? `${total} resultados para “${q}”`
          : total > 0
            ? `${total} productos`
            : 'Productos de la categoría'}
      </p>

      <CategorySummaryBar summary={summary} />

      <form method="get" action={`/categoria/${slug}`} className="mb-6 mt-8">
        <div className="flex gap-2">
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={`Buscar en ${match.name}…`}
            aria-label={`Buscar en ${match.name}`}
          />
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </div>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q
            ? 'No se encontraron productos para esa búsqueda.'
            : 'Todavía no hay productos en esta categoría.'}
        </p>
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
              <Link href={pageHref(page - 1)}>Anterior</Link>
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
              <Link href={pageHref(page + 1)}>Siguiente</Link>
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

function CategorySummaryBar({ summary }: { summary: CategorySummary | null }) {
  if (!summary || summary.total_products === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Sin datos de esta categoría todavía.
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-2">
      <div>
        <p className="text-xs text-muted-foreground">Precio promedio</p>
        <p className="text-lg font-bold">{formatArs(summary.avg_best_price)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Mejor ahorro 30 días</p>
        {summary.best_savings ? (
          <Link href={`/p/${summary.best_savings.slug}`} className="block">
            <p className="truncate font-semibold">{summary.best_savings.name}</p>
            <p className="text-xs text-alerta">
              {formatArs(summary.best_savings.best_price)} · -
              {summary.best_savings.savings_pct.toFixed(1)}%
            </p>
          </Link>
        ) : (
          <p className="text-muted-foreground">—</p>
        )}
      </div>
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
