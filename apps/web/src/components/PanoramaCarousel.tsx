'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Dashboard "Panorama de precios": en desktop muestra todas las tarjetas en una
 * grilla; en mobile recorre las tarjetas en un carrusel que avanza solo cada
 * 5 segundos para aprovechar mejor el espacio.
 */
export function PanoramaCarousel({ children }: { children: ReactNode[] }) {
  const [index, setIndex] = useState(0);
  const tileCount = children.length;

  useEffect(() => {
    if (tileCount <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % tileCount);
    }, 5000);
    return () => clearInterval(timer);
  }, [tileCount]);

  const goTo = (n: number) => setIndex(((n % tileCount) + tileCount) % tileCount);

  return (
    <>
      {/* Desktop: grilla completa */}
      <div className="hidden grid-cols-2 gap-3 sm:grid">{children}</div>

      {/* Mobile: carrusel automático */}
      <div className="sm:hidden">
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-in-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {children.map((child, i) => (
              <div key={i} className="w-full shrink-0 px-0.5">
                {child}
              </div>
            ))}
          </div>
        </div>
        {tileCount > 1 && (
          <div className="mt-2 flex items-center justify-center gap-1.5">
            {children.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Ver tarjeta ${i + 1} de ${tileCount}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-4 bg-alerta' : 'w-1.5 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
