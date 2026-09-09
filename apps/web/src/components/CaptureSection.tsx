'use client';

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Download, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CaptureSectionProps {
  title: string;
  description?: string;
  fileName: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Bloque del panel de analíticas con botón "Descargar imagen": captura el
 * bloque (con cabecera de marca + fecha) como PNG para compartir (WhatsApp,
 * redes). La captura fuerza tema claro sacando temporalmente la clase .dark.
 */
export function CaptureSection({
  title,
  description,
  fileName,
  action,
  children,
}: CaptureSectionProps) {
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

    // Expandir temporalmente cualquier contenedor con scroll para que la
    // captura incluya todo el contenido (sin bars de scroll ni recortes).
    const expandable: HTMLElement[] = [];
    if (el.scrollHeight > el.clientHeight + 2) expandable.push(el);
    el.querySelectorAll('div').forEach((node) => {
      if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 2) {
        expandable.push(node);
      }
    });
    const backups = expandable.map((n) => ({
      el: n,
      maxHeight: n.style.maxHeight,
      overflow: n.style.overflow,
      overflowY: n.style.overflowY,
    }));
    expandable.forEach((n) => {
      n.style.maxHeight = 'none';
      n.style.overflow = 'visible';
    });

    try {
      const dataUrl = await toPng(el, {
        width: el.scrollWidth,
        height: el.scrollHeight,
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        cacheBust: true,
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          if (node.dataset.captureExclude === 'true') return false;
          if (node.closest('[data-capture-exclude="true"]')) return false;
          return true;
        },
      });
      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      link.click();
    } catch {
      setError('No se pudo generar la imagen. Volvé a intentarlo.');
    } finally {
      backups.forEach(({ el: n, maxHeight, overflow, overflowY }) => {
        n.style.maxHeight = maxHeight;
        n.style.overflow = overflow;
        n.style.overflowY = overflowY;
      });
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
        <div className="flex flex-wrap items-center gap-2">
          {action}
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="font-semibold">
            Sigma <span className="text-alerta">Tecnologías</span>
          </span>
          <span className="shrink-0">Difundido por Tandil Alerta</span>
        </div>
      </div>
    </section>
  );
}
