import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listCategoryProducts } from '@/lib/queries/category-products';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const db = getDb();
    const { slug } = await params;
    const limitRaw = Number(new URL(request.url).searchParams.get('limit'));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

    const products = await listCategoryProducts(db, slug, { limit });
    if (products === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Categoría no encontrada: ${slug}` } },
        { status: 404 },
      );
    }
    return NextResponse.json({ products });
  } catch (err) {
    console.error('[category-products]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
