'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
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
          className="h-11 rounded-lg pl-9 text-base"
        />
      </div>
      {status === 'loading' && (
        <p
          role="status"
          className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm text-muted-foreground shadow"
        >
          Buscando…
        </p>
      )}
      {status === 'done' && open && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {hits.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              Sin resultados para “{query}”. Probá con otra palabra o el nombre de marca (ej.:
              “arroz gallo”).
            </li>
          ) : (
            hits.map((hit) => (
              <li key={hit.slug}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={() => router.push(`/p/${hit.slug}`)}
                >
                  <span>{hit.name}</span>
                  {hit.best_price !== null && (
                    <span className="text-sm font-semibold text-primary">
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
        <p role="alert" className="mt-1 text-sm text-destructive">
          No pudimos buscar en este momento. Reintentá en unos segundos.
        </p>
      )}
    </div>
  );
}
