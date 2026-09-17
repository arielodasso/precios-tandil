import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Paginación con acceso directo a la primera y última página como
 * enlaces de texto secundarios ("Pág. 1" / "Pág. X").
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
  const edgeLink =
    'text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline';
  return (
    <nav
      aria-label="Paginación"
      className="mt-6 flex flex-wrap items-center justify-center gap-1.5 sm:gap-3"
    >
      {page > 1 ? (
        <Link href={href(1)} className={edgeLink}>
          Pág. 1
        </Link>
      ) : (
        <span className={`${edgeLink} text-muted-foreground/60`} aria-disabled="true">
          Pág. 1
        </span>
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
      <span className="text-sm tabular-nums text-muted-foreground">
        {page}/{totalPages}
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
        <Link href={href(totalPages)} className={edgeLink}>
          Pág. {totalPages}
        </Link>
      ) : (
        <span className={`${edgeLink} text-muted-foreground/60`} aria-disabled="true">
          Pág. {totalPages}
        </span>
      )}
    </nav>
  );
}
