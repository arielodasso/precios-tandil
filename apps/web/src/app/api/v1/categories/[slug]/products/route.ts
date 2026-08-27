import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listCategoryProducts } from '@/lib/queries/category-products';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const db = getDb();
    const { slug } = await params;
    const url = new URL(request.url);
    const pageRaw = Number(url.searchParams.get('page'));
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const sizeRaw = Number(url.searchParams.get('pageSize'));
    const pageSize = Number.isInteger(sizeRaw) && sizeRaw > 0 ? sizeRaw : undefined;
    const legacyLimit = Number(url.searchParams.get('limit'));

    const result = await listCategoryProducts(db, slug, { page, pageSize });
    if (result === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Categoría no encontrada: ${slug}` } },
        { status: 404 },
      );
    }
    const legacy = Number.isInteger(legacyLimit) && legacyLimit > 0 ? legacyLimit : 10;
    const products = legacy === 10 ? result.items : result.items.slice(0, legacy);
    return NextResponse.json({
      products,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  } catch (err) {
    console.error('[category-products]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
