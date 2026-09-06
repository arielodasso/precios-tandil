'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';

/**
 * Imagen de producto que siempre muestra algo: si el src de la tienda
 * falla o es null, se muestra el placeholder en su lugar (onError).
 * Usa next/image: Vercel optimiza (AVIF/WebP) y cachea en CDN.
 */
export function ProductImage({ src, alt }: { src: string | null | undefined; alt: string }) {
  const [error, setError] = useState(false);
  const showImage = !!src && !error;

  if (!showImage) {
    return <ImageOff className="size-6 text-muted-foreground" />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={128}
      height={128}
      loading="lazy"
      sizes="128px"
      onError={() => setError(true)}
      className="h-full w-full object-cover"
    />
  );
}
