'use client';

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Download, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CaptureSectionProps {
  title: string;
  description?: string;
  fileName: string;
  children: React.ReactNode;
}

/**
 * Bloque del panel de analíticas con botón "Descargar imagen": captura el
 * bloque (con cabecera de marca + fecha) como PNG para compartir (WhatsApp,
 * redes). La captura fuerza tema claro sacando temporalmente la clase .dark.
 */
export function CaptureSection({ title, description, fileName, children }: CaptureSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    const el = ref.current;
    if (!el || busy) return;
    setBusy(true);
    setError(null);

    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    if (wasDark) root.classList.remove('dark');

    try {
      const dataUrl = await toPng(el, {
        width: el.scrollWidth,
        height: el.scrollHeight,
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      link.click();
    } catch {
      setError('No se pudo generar la imagen. Volvé a intentarlo.');
    } finally {
      if (wasDark) root.classList.add('dark');
      setBusy(false);
    }
  }

  const today = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long' }).format(new Date());

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          {error && (
            <p role="alert" className="mt-1 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void download();
          }}
          disabled={busy}
        >
          {busy ? <Loader className="size-4 animate-spin" /> : <Download className="size-4" />}
          {busy ? 'Generando…' : 'Descargar imagen'}
        </Button>
      </div>

      <div
        ref={ref}
        className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-extrabold tracking-tight text-foreground">
            Precios <span className="text-alerta">Tandil</span> · {title}
          </p>
          <p className="shrink-0 text-xs text-muted-foreground">{today}</p>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </section>
  );
}
