'use client';

import { useMemo, useState } from 'react';
import { ProductCard, type ProductCardData } from './ProductCard';
import { SortBar, type SortOption } from './SortBar';

/**
 * Listado de tarjetas con ordenamiento client-side (sin paginación).
 * Útil para páginas con pocos ítems como /ofertas.
 */
export function SortableProductList({
  products,
  defaultSort = 'price_asc',
  className,
}: {
  products: ProductCardData[];
  defaultSort?: SortOption;
  className?: string;
}) {
  const [sort, setSort] = useState<SortOption>(defaultSort);

  const sorted = useMemo(() => {
    const list = [...products];
    if (sort === 'az') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    } else if (sort === 'za') {
      list.sort((a, b) => b.name.localeCompare(a.name, 'es'));
    } else if (sort === 'price_desc') {
      list.sort((a, b) => (b.best_price ?? -Infinity) - (a.best_price ?? -Infinity));
    } else if (sort === 'price_asc') {
      list.sort((a, b) => (a.best_price ?? Infinity) - (b.best_price ?? Infinity));
    }
    return list;
  }, [products, sort]);

  return (
    <div className={className}>
      {products.length > 0 && <SortBar current={sort} onSelect={setSort} className="mb-6" />}
      <ul className="grid grid-cols-1 gap-3">
        {sorted.map((p) => (
          <li key={p.slug}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}
