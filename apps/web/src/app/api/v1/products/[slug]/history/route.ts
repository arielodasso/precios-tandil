import { NextResponse } from 'next/server';
import { AppError } from '@precios/shared';
import { cachedProductHistory } from '@/lib/queries/cached';
import { jsonWithCache } from '@/lib/http';

const VALID_WINDOWS = new Set(['30', '90', 'all']);

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const window = (new URL(request.url).searchParams.get('window') ?? '30') as string;
    if (!VALID_WINDOWS.has(window)) {
      return errorResponse('invalid_query', "Parámetro window inválido (usar 30, 90 o 'all')", 400);
    }

    const history = await cachedProductHistory(slug, window);
    return jsonWithCache(history);
  } catch (err) {
    console.error('[history]', err);
    if (err instanceof AppError && err.code === 'not_found') {
      const { slug } = await params;
      return errorResponse('not_found', `Producto '${slug}' no encontrado`, 404);
    }
    return errorResponse('internal_error', 'Error interno', 500);
  }
}
