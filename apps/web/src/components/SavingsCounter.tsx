import { sql } from 'kysely';
import { getDb } from '@/lib/db';
import { PiggyBank } from 'lucide-react';

function formatArsBig(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value);
}

/**
 * Contador del ahorro agregado de todos los tandilenses que usan Precios Tandil.
 * Lee directamente de la tabla user_savings (información real en la DB).
 */
export async function SavingsCounter() {
  let total = 0;
  let contributors = 0;

  try {
    const db = getDb();
    const result = await sql<{ total: string; contributors: number }>`
      SELECT
        coalesce(round(sum(savings_amount)::numeric, 0), 0)::text as total,
        count(*)::int as contributors
      FROM user_savings
    `.execute(db);
    const row = result.rows[0];
    total = Number(row?.total ?? 0);
    contributors = Number(row?.contributors ?? 0);
  } catch {
    total = 0;
    contributors = 0;
  }

  return (
    <div className="rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-800/50">
      <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
        <PiggyBank className="size-4" />
        <p className="text-xs font-semibold">Los tandilenses ahorraron</p>
      </div>
      <p
        className="mt-1 text-2xl font-extrabold text-emerald-700 dark:text-emerald-400"
        aria-live="polite"
      >
        ${formatArsBig(total)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {contributors > 0
          ? `usando Precios Tandil`
          : '¡Sumá tus productos a una lista y empezá a ahorrar!'}
      </p>
    </div>
  );
}
