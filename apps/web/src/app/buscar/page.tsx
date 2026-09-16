import { sql } from 'kysely';
import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { ProductCard } from '@/components/ProductCard';
import { BackButton } from '@/components/BackButton';
import { Pagination } from '@/components/Pagination';
import { SortBar, type SortOption } from '@/components/SortBar';
import { loadOffersByProduct } from '@/lib/queries/offers';
import type { CardOffer, ProductUnit } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { stripAccents } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Buscar productos',
  description: 'Buscá productos y compará precios entre los supermercados de Tandil.',
  alternates: { canonical: '/buscar' },
  robots: { index: false, follow: true },
};

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
  const rawSort = Array.isArray(query.sort) ? query.sort[0] : query.sort;
  const sort: SortOption =
    rawSort === 'az' || rawSort === 'za' || rawSort === 'price_asc' || rawSort === 'price_desc'
      ? rawSort
      : 'relevance';
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);

  const db = getDb();

  const items: Array<{
    id: number;
    slug: string;
    name: string;
    brand: string | null;
    unit: ProductUnit | null;
    best_price: number | null;
    stores_count: number | null;
    image_url: string | null;
    offers: CardOffer[];
  }> = [];
  let total = 0;
  let totalPages = 1;

  if (q.length >= 2 && q.length <= 64) {
    const qNorm = stripAccents(q);
    const tsQuery = sql`websearch_to_tsquery('spanish', unaccent(${q}))`;
    const orderClause =
      sort === 'az'
        ? sql`order by p.canonical_name asc nulls last`
        : sort === 'za'
          ? sql`order by p.canonical_name desc nulls last`
          : sort === 'price_asc'
            ? sql`order by pa.best_price asc nulls last`
            : sort === 'price_desc'
              ? sql`order by pa.best_price desc nulls last`
              : sql`order by greatest(
                     ts_rank_cd(p.search_vector, ${tsQuery}),
                     similarity(p.canonical_name, unaccent(${q}))
                   ) desc,
                   pa.best_price asc nulls last`;
    const countRows = await sql<{ total: number }>`
      select count(*)::int as total
      from product p
      join price_aggregate pa on pa.product_id = p.id
      where (p.search_vector @@ ${tsQuery} or p.canonical_name % unaccent(${q})
             or unaccent(coalesce(p.canonical_name, '')) ilike ${`%${qNorm}%`}
             or unaccent(coalesce(p.brand, '')) ilike ${`%${qNorm}%`})
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
      unit_amount: string | null;
      unit_type: string | null;
      best_price: number | null;
      stores_count: number | null;
      image_url: string | null;
    }>`
      select p.id,
             p.slug,
             p.canonical_name as name,
             p.brand,
             p.unit_amount,
             p.unit_type,
             pa.best_price::float8 as best_price,
             pa.stores_count,
             p.image_url
      from product p
      join price_aggregate pa on pa.product_id = p.id
      where (p.search_vector @@ ${tsQuery} or p.canonical_name % unaccent(${q})
             or unaccent(coalesce(p.canonical_name, '')) ilike ${`%${qNorm}%`}
             or unaccent(coalesce(p.brand, '')) ilike ${`%${qNorm}%`})
        and exists (
          select 1 from price_record pr
          join store_sku ss on ss.id = pr.store_sku_id
          join match_link ml on ml.store_sku_id = ss.id and ml.status in ('auto','confirmed')
          where pr.is_suspect = false
            and pr.captured_at >= now() - ${freshWindowInterval}
            and ml.product_id = p.id
        )
      ${orderClause}
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
        unit:
          r.unit_amount != null && r.unit_type != null
            ? { amount: Number(r.unit_amount), type: r.unit_type as ProductUnit['type'] }
            : null,
        best_price: r.best_price === null ? null : Math.round(Number(r.best_price) * 100) / 100,
        stores_count: r.stores_count,
        image_url: r.image_url,
        offers: offersByProduct.get(id) ?? [],
      });
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
