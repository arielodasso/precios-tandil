import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';

interface CategoryCountRow {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  path: string;
  direct_count: string | number;
}

interface CategoryNode {
  slug: string;
  name: string;
  path: string;
  product_count: number;
  children: CategoryNode[];
}

export async function GET() {
  try {
    const db = getDb();
    const rows = await sql<CategoryCountRow>`
      select c.id, c.slug, c.name, c.parent_id, c.path,
             (select count(*)::int from product p where p.category_id = c.id) as direct_count
      from category c order by c.path asc
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
      for (const child of node.children) total += aggregateTotals(child);
      node.product_count = total;
      return total;
    };
    for (const root of roots) aggregateTotals(root);

    return NextResponse.json({ categories: roots });
  } catch (err) {
    console.error('[categories]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
