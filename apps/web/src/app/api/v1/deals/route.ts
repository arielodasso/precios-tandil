import { NextResponse } from 'next/server';
import { cachedDealsApi } from '@/lib/queries/cached';
import { jsonWithCache } from '@/lib/http';

export async function GET(request: Request) {
  try {
    const status = new URL(request.url).searchParams.get('status') ?? 'published';
    if (status !== 'published') {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_query',
            message: "Solo se permite status='published' en el endpoint publico",
          },
        },
        { status: 400 },
      );
    }

    const deals = await cachedDealsApi();
    return jsonWithCache({ deals });
  } catch (err) {
    console.error('[deals]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
