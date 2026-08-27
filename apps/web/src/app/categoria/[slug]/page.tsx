import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getCategoryTree, type CategoryNode } from '@/lib/queries/categories';
import { listCategoryProducts } from '@/lib/queries/category-products';
import { ProductCard } from '@/components/ProductCard';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Categoría' };

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();

  const tree = await getCategoryTree(db);
  const match = findCategory(tree, slug);
  if (!match) notFound();

  const products = await listCategoryProducts(db, slug);

  return (
    <div className="py-6">
      <h1 className="mb-1 text-2xl font-bold">{match.name}</h1>
      <p className="mb-5 text-sm text-muted-foreground">Productos con precios frescos</p>

      {products === null || products.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay productos con precios frescos en esta categoría.
        </p>
      ) : (
        <ul className="grid gap-3">
          {products.map((p) => (
            <li key={p.slug}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
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
