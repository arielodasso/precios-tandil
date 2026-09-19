import { NextResponse } from 'next/server';
import { AppError } from '@precios/shared';
import { cachedProductDetail } from '@/lib/queries/cached';
import { jsonWithCache } from '@/lib/http';

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const detail = await cachedProductDetail(slug);
    if (!detail) return errorResponse('not_found', `Producto no encontrado: ${slug}`, 404);
    return jsonWithCache(detail);
  } catch (err) {
    console.error('[product]', err);
    if (err instanceof AppError && err.code === 'not_found') {
      const { slug } = await params;
      return errorResponse('not_found', `Producto no encontrado: ${slug}`, 404);
    }
    return errorResponse('internal_error', 'Error interno', 500);
  }
}
