export function Footer() {
  return (
    <footer className="border-t border-border bg-black py-6 text-center text-xs text-white/70">
      <p>
        Tecnología de análisis impulsada por{' '}
        <a
          href="https://sigmatecnologiasarg.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-alerta hover:text-alerta-strong"
        >
          Sigma Tecnologías
        </a>{' '}
        &middot; Difundido por{' '}
        <a
          href="https://www.instagram.com/tandilalerta/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-alerta hover:text-alerta-strong"
        >
          Tandil Alerta
        </a>
      </p>
      <p className="mt-1">
        Datos informativos, sin garantía. Los precios corresponden a publicaciones oficiales de cada
        supermercado.
      </p>
    </footer>
  );
}
