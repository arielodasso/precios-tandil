import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import type { ApiConfig } from '../../lib/config.ts';
import { validateSearchQuery } from './search.ts';

const config: ApiConfig = {
  PORT: 0,
  DATABASE_URL: 'postgresql://usuario:clave@127.0.0.1:59999/inexistente',
  NODE_ENV: 'test',
};

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(config);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/search validación', () => {
  it('rechaza sin q', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/search' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('invalid_query');
  });

  it('rechaza q demasiado corta', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=a' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('rechaza q demasiado larga', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${'x'.repeat(65)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('rechaza limit fuera de rango', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=arroz&limit=21' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('rechaza limit no numérico', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=arroz&limit=abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('rechaza cursor inválido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=arroz&cursor=%21%21nocursor',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('mapea errores de base de datos a internal_error con correlationId', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=arroz' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('internal_error');
    expect(typeof body.error.correlationId).toBe('string');
  }, 20_000);
});

describe('validateSearchQuery normalización', () => {
  it('aplica defaults y normaliza tiendas repetidas', () => {
    const parsed = validateSearchQuery({
      q: '  arroz gallo  ',
      store: ['dia', '', 'vea'],
    });
    expect(parsed.q).toBe('arroz gallo');
    expect(parsed.limit).toBe(8);
    expect(parsed.stores).toEqual(['dia', 'vea']);
    expect(parsed.category).toBeUndefined();
    expect(parsed.cursor).toBeUndefined();
  });

  it('acepta store único como string', () => {
    const parsed = validateSearchQuery({ q: 'yerba', store: 'dia' });
    expect(parsed.stores).toEqual(['dia']);
  });
});
