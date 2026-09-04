'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Botón "volver" que regresa a la página anterior del historial del
 * navegador. Se coloca junto a los títulos de las páginas.
 */
export function BackButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => router.back()}
      className="shrink-0"
      aria-label="Volver a la página anterior"
    >
      <ArrowLeft className="size-4" />
      <span className="hidden sm:inline">Volver</span>
    </Button>
  );
}
