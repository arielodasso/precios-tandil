export function Footer() {
  return (
    <footer className="border-t border-border bg-black py-8 text-center text-xs text-white/60">
      <div className="mx-auto max-w-3xl px-4">
        <p className="font-medium text-white/80">
          Tecnología de análisis impulsada por{' '}
          <a
            href="https://sigmatecnologiasarg.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-alerta transition-colors hover:text-alerta-strong"
          >
            Sigma Tecnologías
          </a>{' '}
          &middot; Difundido por{' '}
          <a
            href="https://www.instagram.com/tandilalerta/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-alerta transition-colors hover:text-alerta-strong"
          >
            Tandil Alerta
          </a>
        </p>
        <p className="mt-2 text-[11px] text-white/40">
          Datos informativos, sin garantía. Los precios corresponden a publicaciones oficiales de
          cada supermercado y no incluyen promociones tipo 2x1 ni descuentos por cantidad.
        </p>
      </div>
    </footer>
  );
}
