'use client';

import { useCallback, useEffect, useState } from 'react';

interface Run {
  run_id: string;
  store_slug: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  skus_captured: number;
  skus_rejected: number;
}

interface PendingMatch {
  id: number;
  product_slug: string;
  product_name: string;
  sku_name: string;
  method: string;
}

/**
 * T068 — Vista admin protegida /admin: tabla de corridas por tienda con
 * botón retry, y cola de revisión de matches (confirmar/rechazar).
 * Protección MVP: token admin ingresado manualmente (Bearer) guardado en
 * sessionStorage; el backend valida contra admin_token.
 */
export default function AdminPage() {
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [matches, setMatches] = useState<PendingMatch[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async (t: string) => {
    const headers = { authorization: `Bearer ${t}` };
    const runsRes = await fetch('/api-proxy/v1/admin/ingest/runs', { headers });
    if (!runsRes.ok) throw new Error('token inválido');
    setRuns(((await runsRes.json()) as { runs: Run[] }).runs);
    const matchesRes = await fetch('/api-proxy/v1/admin/matches/pending', { headers });
    if (matchesRes.ok) {
      setMatches(((await matchesRes.json()) as { matches: PendingMatch[] }).matches);
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem('admin_token');
    if (saved) {
      load(saved)
        .then(() => {
          setToken(saved);
          setAuthed(true);
        })
        .catch(() => sessionStorage.removeItem('admin_token'));
    }
  }, [load]);

  async function retryStore(slug: string): Promise<void> {
    setMessage('');
    const res = await fetch(`/api-proxy/v1/admin/ingest/stores/${slug}/retry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: '{}',
    });
    setMessage(
      res.status === 202
        ? `Corrida re-encolada para ${slug}.`
        : res.status === 409
          ? `${slug}: ya hay una corrida en curso.`
          : `Error ${res.status} al re-encolar.`,
    );
  }

  async function decide(id: number, decision: 'confirmed' | 'rejected'): Promise<void> {
    const res = await fetch(`/api-proxy/v1/admin/matches/${id}/decision`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    if (res.ok) setMatches((prev) => prev.filter((m) => m.id !== id));
    else setMessage(`Error ${res.status} decidiendo match.`);
  }

  if (!authed) {
    return (
      <div className="py-10">
        <h1 className="mb-4 text-xl font-bold">Acceso admin</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(token)
              .then(() => {
                sessionStorage.setItem('admin_token', token);
                setAuthed(true);
              })
              .catch(() => setMessage('Token inválido o revocado.'));
          }}
          className="flex gap-2"
        >
          <input
            type="password"
            aria-label="Token admin"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded border border-black/15 bg-[var(--surface)] px-3 py-2 dark:border-white/15"
          />
          <button
            type="submit"
            className="rounded bg-[var(--accent)] px-4 py-2 font-semibold text-white"
          >
            Ingresar
          </button>
        </form>
        <p role="alert" className="mt-2 text-sm text-red-600">
          {message}
        </p>
      </div>
    );
  }

  return (
    <div className="py-6">
      <h1 className="mb-4 text-xl font-bold">Panel admin</h1>
      <p role="status" className="mb-3 text-sm">
        {message}
      </p>

      <h2 className="mb-2 font-semibold">Últimas corridas</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Corridas de ingesta por tienda</caption>
          <thead>
            <tr className="text-left text-[var(--muted)]">
              <th scope="col">Tienda</th>
              <th scope="col">Estado</th>
              <th scope="col">SKUs</th>
              <th scope="col">Rechazados</th>
              <th scope="col">Iniciada</th>
              <th scope="col">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 20).map((run) => (
              <tr key={run.run_id} className="border-t border-black/5 dark:border-white/10">
                <td>{run.store_slug}</td>
                <td>{run.status}</td>
                <td>{run.skus_captured}</td>
                <td>{run.skus_rejected}</td>
                <td>{new Date(run.started_at).toLocaleString('es-AR')}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => retryStore(run.store_slug)}
                    className="rounded border border-[var(--accent)] px-2 py-1 text-xs text-[var(--accent-strong)]"
                  >
                    Reintentar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-8 font-semibold">Matches pendientes ({matches.length})</h2>
      {matches.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No hay matches para revisar.</p>
      ) : (
        <ul className="grid gap-2">
          {matches.map((match) => (
            <li
              key={match.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-black/10 p-3 text-sm dark:border-white/10"
            >
              <span>
                <strong>{match.product_name}</strong> ↔ {match.sku_name}{' '}
                <span className="text-[var(--muted)]">({match.method})</span>
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => decide(match.id, 'confirmed')}
                  className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white"
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  onClick={() => decide(match.id, 'rejected')}
                  className="rounded border border-red-600 px-3 py-1 text-xs font-semibold text-red-700 dark:text-red-400"
                >
                  Rechazar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
