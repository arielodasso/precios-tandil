import Link from 'next/link';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';
import { ProductCard } from '@/components/ProductCard';
import { BackButton } from '@/components/BackButton';
import { loadOffersByProduct } from '@/lib/queries/offers';
import type { CardOffer } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Buscar productos' };

const PAGE_SIZE = 12;
const FRESH_WINDOW_DAYS = 7;
const freshWindowInterval = sql.raw(`interval '${FRESH_WINDOW_DAYS} days'`);

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const rawQ = Array.isArray(query.q) ? query.q[0] : query.q;
  const q = (rawQ ?? '').trim();
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);

  const db = getDb();

  const items: Array<{
    id: number;
    slug: string;
    name: string;
    brand: string | null;
    best_price: number | null;
    stores_count: number | null;
    image_url: string | null;
    offers: CardOffer[];
  }> = [];
  let total = 0;
  let totalPages = 1;

  if (q.length >= 2 && q.length <= 64) {
    const tsQuery = sql`websearch_to_tsquery('spanish', ${q})`;
    const countRows = await sql<{ total: number }>`
      select count(*)::int as total
      from product p
      join price_aggregate pa on pa.product_id = p.id
      where (p.search_vector @@ ${tsQuery} or p.canonical_name % ${q}
             or p.canonical_name ilike ${`%${q}%`} or p.brand ilike ${`%${q}%`})
        and exists (
          select 1 from price_record pr
          join store_sku ss on ss.id = pr.store_sku_id
          join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto','confirmed')
          where pr.is_suspect = false
            and pr.captured_at >= now() - ${freshWindowInterval}
            and ml.product_id = p.id
        )
    `.execute(db);
    total = Number(countRows.rows[0]?.total ?? 0);
    totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const offset = (page - 1) * PAGE_SIZE;
    const rows = await sql<{
      id: string | number;
      slug: string;
      name: string;
      brand: string | null;
      best_price: number | null;
      stores_count: number | null;
      image_url: string | null;
    }>`
      select p.id,
             p.slug,
             p.canonical_name as name,
             p.brand,
             pa.best_price::float8 as best_price,
             pa.stores_count,
             p.image_url
      from product p
      join price_aggregate pa on pa.product_id = p.id
      where (p.search_vector @@ ${tsQuery} or p.canonical_name % ${q}
             or p.canonical_name ilike ${`%${q}%`} or p.brand ilike ${`%${q}%`})
        and exists (
          select 1 from price_record pr
          join store_sku ss on ss.id = pr.store_sku_id
          join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto','confirmed')
          where pr.is_suspect = false
            and pr.captured_at >= now() - ${freshWindowInterval}
            and ml.product_id = p.id
        )
      order by greatest(
                 ts_rank_cd(p.search_vector, ${tsQuery}),
                 similarity(p.canonical_name, ${q})
               ) desc,
               pa.best_price asc nulls last
      limit ${PAGE_SIZE} offset ${offset}
    `.execute(db);

    const ids = rows.rows.map((r) => Number(r.id));
    const offersByProduct = await loadOffersByProduct(db, ids);

    for (const r of rows.rows) {
      const id = Number(r.id);
      items.push({
        id,
        slug: r.slug,
        name: r.name,
        brand: r.brand,
        best_price: r.best_price === null ? null : Math.round(Number(r.best_price) * 100) / 100,
        stores_count: r.stores_count,
        image_url: r.image_url,
        offers: offersByProduct.get(id) ?? [],
      });
    }
  }

  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  const pageHref = (p: number) => {
    const params = new URLSearchParams(qs);
    params.set('page', String(p));
    return `/buscar?${params.toString()}`;
  };

  return (
    <div className="py-6">
      <div className="mb-1 flex items-center gap-3">
        <BackButton />
        <h1 className="text-2xl font-bold">Buscar productos</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        {q
          ? `${total} resultados para “${q}”`
          : 'Ingresá un término para buscar en todos los productos.'}
      </p>

      <form method="get" action="/buscar" className="mb-6">
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

      {totalPages > 1 && (
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
