'use client';

import { useState } from 'react';
import { Download, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Botón que descarga los datos recibidos como CSV (UTF-8 BOM para que Excel
 * abra los acentos correctamente). Pensado para el panel de analíticas.
 */
export function ExportCsvButton({
  fileName,
  headers,
  rows,
  label = 'Exportar CSV',
}: {
  fileName: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  function escapeCell(v: string | number | null | undefined): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s) || s.startsWith(' ')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function download() {
    setBusy(true);
    try {
      const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(';')).join('\r\n');
      const blob = new Blob(['\uFEFF' + lines], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={download} disabled={busy}>
      {busy ? <Loader className="size-4 animate-spin" /> : <Download className="size-4" />}
      {busy ? 'Generando…' : label}
    </Button>
  );
}
