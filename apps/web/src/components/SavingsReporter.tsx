'use client';

import { useEffect, useRef } from 'react';
import { useProductList } from './ProductListContext';

const DEVICE_KEY = 'precios-tandil-device';

function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        'd_' +
        Math.random().toString(36).slice(2) +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/**
 * Reporta al backend el ahorro actual de este usuario (agregado anónimo por
 * device_id). Esto alimenta el contador "cuánto llevan ahorrado los tandilenses"
 * en el dashboard. Reporta cada vez que el ahorro cambia (incluyendo a 0)
 * para que el agregado sea real y se mantenga actualizado.
 */
export function SavingsReporter() {
  const { savings, items } = useProductList();
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const deviceId = getDeviceId();
    if (!deviceId) return;

    // Reportar si el ahorro o la lista cambiaron desde el último envío.
    // Se reporta también un ahorro en 0 (lista vacía) para que el agregado
    // refleje siempre valores reales y no queden montos desactualizados.
    const key = `${Math.round(savings * 100)}:${items.length}`;
    if (reported.current === key) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch('/api/v1/savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          savings: Math.round(savings * 100) / 100,
          item_count: items.length,
        }),
        signal: controller.signal,
      })
        .then(() => {
          reported.current = key;
        })
        .catch(() => {
          /* silencioso: si falla, se reintenta en el próximo cambio */
        });
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [savings, items]);

  return null;
}
