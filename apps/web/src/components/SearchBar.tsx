'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { SearchResultItem, SearchResponse } from '@/lib/types';

/**
 * T041 — Barra de búsqueda con debounce de 150 ms y sugerencias.
 * Estados: loading textual y sin resultados con sugerencias (T074).
 */
export function SearchBar() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchResultItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setHits([]);
      setStatus('idle');
      return;
    }
    timer.current = setTimeout(async () => {
      setStatus('loading');
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query.trim())}&limit=8`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as SearchResponse;
        setHits(data.results ?? []);
        setStatus('done');
      } catch {
        setStatus('error');
      }
    }, 150);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <div role="search" className="relative">
      <input
        type="search"
        aria-label="Buscar producto"
        placeholder="Buscar producto…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-lg border border-black/15 bg-[var(--surface)] px-4 py-3 text-base outline-none focus:border-[var(--accent)] dark:border-white/15"
      />
      {status === 'loading' && (
        <p
          role="status"
          className="absolute z-10 mt-1 w-full rounded bg-[var(--surface)] p-2 text-sm text-[var(--muted)] shadow"
        >
          Buscando…
        </p>
      )}
      {status === 'done' && open && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded bg-[var(--surface)] shadow-lg">
          {hits.length === 0 ? (
            <li className="px-4 py-3 text-sm text-[var(--muted)]">
              Sin resultados para “{query}”. Probá con otra palabra o el nombre de marca (ej.:
              “arroz gallo”).
            </li>
          ) : (
            hits.map((hit) => (
              <li key={hit.slug}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/10"
                  onMouseDown={() => router.push(`/p/${hit.slug}`)}
                >
                  <span>{hit.name}</span>
                  {hit.best_price !== null && (
                    <span className="text-sm font-semibold text-[var(--accent-strong)]">
                      ${hit.best_price.toFixed(2)}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {status === 'error' && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          No pudimos buscar en este momento. Reintentá en unos segundos.
        </p>
      )}
    </div>
  );
}
