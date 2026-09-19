import { NextResponse } from 'next/server';
import { cachedStoresStatus } from '@/lib/queries/cached';
import { jsonWithCache } from '@/lib/http';

export async function GET() {
  try {
    const stores = await cachedStoresStatus();
    return jsonWithCache({ stores });
  } catch (err) {
    console.error('[stores]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
