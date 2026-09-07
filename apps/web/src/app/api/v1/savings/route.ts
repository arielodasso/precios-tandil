import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { getDb } from '@/lib/db';
import { jsonWithCache, SEARCH_JSON_CACHE } from '@/lib/http';

/**
 * POST /api/v1/savings
 * Reporta el ahorro actual de un usuario (upsert por device_id anónimo).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      device_id?: string;
      savings?: number;
      item_count?: number;
    } | null;

    const deviceId =
      typeof body?.device_id === 'string' && body.device_id.length > 1
        ? body.device_id.slice(0, 128)
        : null;
    const savings =
      typeof body?.savings === 'number' && Number.isFinite(body.savings)
        ? Math.max(0, body.savings)
        : 0;
    const itemCount =
      typeof body?.item_count === 'number' && Number.isFinite(body.item_count)
        ? Math.max(0, Math.floor(body.item_count))
        : 0;

    if (!deviceId) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'device_id requerido' } },
        { status: 400 },
      );
    }

    const db = getDb();
    await sql`
      INSERT INTO user_savings (device_id, savings_amount, item_count, updated_at)
      VALUES (${deviceId}, ${savings}, ${itemCount}, now())
      ON CONFLICT (device_id) DO UPDATE SET
        savings_amount = EXCLUDED.savings_amount,
        item_count = EXCLUDED.item_count,
        updated_at = now()
    `.execute(db);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[savings POST]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}

/**
 * GET /api/v1/savings
 * Devuelve el ahorro total agregado de todos los usuarios reportando.
 */
export async function GET() {
  try {
    const db = getDb();
    const result = await sql<{ total: string; contributors: number }>`
      SELECT
        coalesce(round(sum(savings_amount)::numeric, 0), 0)::text as total,
        count(*)::int as contributors
      FROM user_savings
    `.execute(db);

    const row = result.rows[0];
    const total = Number(row?.total ?? 0);
    const contributors = Number(row?.contributors ?? 0);

    return jsonWithCache({ totalSavings: total, contributors }, SEARCH_JSON_CACHE);
  } catch (err) {
    console.error('[savings GET]', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Error interno' } },
      { status: 500 },
    );
  }
}
