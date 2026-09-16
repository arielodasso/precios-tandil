'use client';

import { useMemo, useState } from 'react';
import { ProductCard, type ProductCardData } from './ProductCard';
import { SortBar, type SortOption } from './SortBar';

/**
 * Lista de tarjetas de producto con ordenamiento en el cliente (A-Z,
 * Z-A, precio menor a mayor / mayor a menor). Se usa en listados sin
 * paginación (p.ej. /ofertas).
 */
export function SortableProductList({ items }: { items: ProductCardData[] }) {
  const [sort, setSort] = useState<SortOption>('relevance');

  const sorted = useMemo(() => {
    const arr = [...items];
    switch (sort) {
      case 'az':
        return arr.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      case 'za':
        return arr.sort((a, b) => b.name.localeCompare(a.name, 'es'));
      case 'price_asc': {
        const rank = (p: ProductCardData) =>
          p.best_price != null ? p.best_price : Number.POSITIVE_INFINITY;
        return arr.sort((a, b) => rank(a) - rank(b));
      }
      case 'price_desc': {
        const rank = (p: ProductCardData) =>
          p.best_price != null ? -p.best_price : Number.NEGATIVE_INFINITY;
        return arr.sort((a, b) => rank(a) - rank(b));
      }
      default:
        return arr;
    }
  }, [items, sort]);

  return (
    <>
      <SortBar current={sort} onSelect={setSort} className="mb-6" />
      <ul className="grid grid-cols-1 gap-3">
        {sorted.map((p) => (
          <li key={p.slug}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </>
  );
}
