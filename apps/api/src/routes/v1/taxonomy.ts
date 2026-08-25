import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@precios/shared';

interface CategoryCountRow {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  path: string;
  direct_count: string | number;
}

export interface CategoryNode {
  slug: string;
  name: string;
  path: string;
  product_count: number;
  children: CategoryNode[];
}

export async function getCategoryTree(db: Kysely<DB>): Promise<CategoryNode[]> {
  const rows = await sql<CategoryCountRow>`
    select c.id, c.slug, c.name, c.parent_id, c.path,
           (select count(*)::int from product p where p.category_id = c.id) as direct_count
    from category c
    order by c.path asc
  `.execute(db);

  const byId = new Map<number, CategoryNode>();
  for (const row of rows.rows) {
    byId.set(row.id, {
      slug: row.slug,
      name: row.name,
      path: row.path,
      product_count: Number(row.direct_count),
      children: [],
    });
  }

  const roots: CategoryNode[] = [];
  for (const row of rows.rows) {
    const node = byId.get(row.id)!;
    if (row.parent_id !== null && byId.has(row.parent_id)) {
      byId.get(row.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const aggregateTotals = (node: CategoryNode): number => {
    let total = node.product_count;
    for (const child of node.children) {
      total += aggregateTotals(child);
    }
    node.product_count = total;
    return total;
  };
  for (const root of roots) aggregateTotals(root);

  return roots;
}

export interface StoreStatus {
  slug: string;
  name: string;
  is_active: boolean;
  last_captured_at: string | null;
  freshness_hours: number | null;
  freshness_status: 'sin_datos' | 'ok' | 'atrasada' | 'rancia';
}

export async function getStoresStatus(db: Kysely<DB>): Promise<StoreStatus[]> {
  const result = await sql<{
    slug: string;
    name: string;
    is_active: boolean;
    last_captured_at: Date | string | null;
  }>`
    select s.slug,
           s.name,
           s.is_active,
           (select max(pr.captured_at)
            from price_record pr
            join store_sku ss on ss.id = pr.store_sku_id
            where ss.store_id = s.id) as last_captured_at
    from store s
    order by s.slug asc
  `.execute(db);

  return result.rows.map((row) => {
    const last = row.last_captured_at ? new Date(row.last_captured_at) : null;
    const hours = last ? Math.floor((Date.now() - last.getTime()) / 3_600_000) : null;
    const status: StoreStatus['freshness_status'] =
      hours === null ? 'sin_datos' : hours < 72 ? 'ok' : hours < 24 * 7 ? 'atrasada' : 'rancia';
    return {
      slug: row.slug,
      name: row.name,
      is_active: row.is_active,
      last_captured_at: last ? last.toISOString() : null,
      freshness_hours: hours,
      freshness_status: status,
    };
  });
}

export async function taxonomyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/categories', async () => ({ categories: await getCategoryTree(app.db) }));
  app.get('/stores', async () => ({ stores: await getStoresStatus(app.db) }));
}
