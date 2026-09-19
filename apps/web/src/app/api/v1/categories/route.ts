import { NextResponse } from 'next/server';
import { cachedCategoryTree } from '@/lib/queries/cached';
import { jsonWithCache } from '@/lib/http';

export async function GET() {
  try {
    const categories = await cachedCategoryTree();
    return jsonWithCache({ categories });
  } catch (err) {
    console.error('[categories]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
