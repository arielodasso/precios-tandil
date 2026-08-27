import Link from 'next/link';
import { formatArs } from './HistoryStrip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface ProductCardData {
  slug: string;
  name: string;
  brand?: string | null;
  best_price?: number | null;
  stores_count?: number | null;
  store_slug?: string | null;
  discount_pct?: number;
}

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link href={`/p/${product.slug}`} className="block">
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="text-base">{product.name}</CardTitle>
          {product.brand ? <CardDescription>{product.brand}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="text-lg font-bold">
            {product.best_price != null ? formatArs(product.best_price) : '—'}
          </span>
          <span className="text-right text-xs text-muted-foreground">
            {typeof product.discount_pct === 'number' && (
              <span className="font-semibold text-emerald-600">
                −{product.discount_pct.toFixed(0)}%
                <br />
              </span>
            )}
            {product.stores_count != null
              ? `${product.stores_count} ${product.stores_count === 1 ? 'tienda' : 'tiendas'}`
              : ''}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
