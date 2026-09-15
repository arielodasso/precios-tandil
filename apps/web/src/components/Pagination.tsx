import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Paginación con acceso directo a la primera y última página.
 */
export function Pagination({
  page,
  totalPages,
  href,
}: {
  page: number;
  totalPages: number;
  href: (p: number) => string;
}) {
  const btnBase = { variant: 'outline', size: 'sm' } as const;
  return (
    <nav aria-label="Paginación" className="mt-6 flex flex-wrap items-center justify-center gap-3">
      {page > 1 ? (
        <Button asChild {...btnBase}>
          <Link href={href(1)}>Primera</Link>
        </Button>
      ) : (
        <Button {...btnBase} disabled>
          Primera
        </Button>
      )}
      {page > 1 ? (
        <Button asChild {...btnBase}>
          <Link href={href(page - 1)}>Anterior</Link>
        </Button>
      ) : (
        <Button {...btnBase} disabled>
          Anterior
        </Button>
      )}
      <span className="text-sm text-muted-foreground">
        Página {page} de {totalPages}
      </span>
      {page < totalPages ? (
        <Button asChild {...btnBase}>
          <Link href={href(page + 1)}>Siguiente</Link>
        </Button>
      ) : (
        <Button {...btnBase} disabled>
          Siguiente
        </Button>
      )}
      {page < totalPages ? (
        <Button asChild {...btnBase}>
          <Link href={href(totalPages)}>Última</Link>
        </Button>
      ) : (
        <Button {...btnBase} disabled>
          Última
        </Button>
      )}
    </nav>
  );
}
