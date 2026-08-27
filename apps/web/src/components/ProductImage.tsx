'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * Imagen de producto que siempre muestra algo: si el src de la tienda
 * falla o es null, se muestra el placeholder en su lugar (onError).
 */
export function ProductImage({ src, alt }: { src: string | null | undefined; alt: string }) {
  const [error, setError] = useState(false);
  const showImage = !!src && !error;

  if (!showImage) {
    return <ImageOff className="size-6 text-muted-foreground" />;
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      width={64}
      height={64}
      onError={() => setError(true)}
      className="h-full w-full object-cover"
    />
  );
}
