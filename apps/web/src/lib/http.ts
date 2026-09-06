import { NextResponse } from 'next/server';

/** Cache-Control para respuestas JSON públicas: CDN 5 min + SWR 1 h. */
export const PUBLIC_JSON_CACHE = 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600';

/** Cache-Control corto para búsquedas (cambian con cada captura). */
export const SEARCH_JSON_CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';

export function jsonWithCache(body: unknown, cacheControl = PUBLIC_JSON_CACHE): NextResponse {
  return NextResponse.json(body, { headers: { 'Cache-Control': cacheControl } });
}
