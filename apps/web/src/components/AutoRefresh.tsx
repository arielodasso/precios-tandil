'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Auto-actualiza la página re-ejecutando el server component (router.refresh)
 * cada `intervalMs` milisegundos. No recarga el navegador ni resetea el scroll:
 * refresca solo la data de la ruta actual.
 */
export function AutoRefresh({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
