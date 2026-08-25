import type { NextRequest } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api/v1';

/**
 * Proxy server-side para evitar CORS y ocultar la URL del API al cliente
 * (usado por SearchBar y la vista admin).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const search = request.nextUrl.search;
  const target = `${API_BASE_URL}/${(path ?? []).join('/')}${search}`;
  const res = await fetch(target, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const target = `${API_BASE_URL}/${(path ?? []).join('/')}`;
  const payload = await request.text();
  const res = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(request.headers.get('authorization')
        ? { authorization: request.headers.get('authorization') as string }
        : {}),
    },
    body: payload,
    cache: 'no-store',
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}
