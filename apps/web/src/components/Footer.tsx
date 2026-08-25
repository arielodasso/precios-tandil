export function Footer() {
  return (
    <footer className="border-t border-black/10 py-6 text-center text-xs text-[var(--muted)] dark:border-white/10">
      <p>
        Tecnología de análisis impulsada por <span className="font-semibold">Sigma</span> &middot;
        Difundido por <span className="font-semibold">Tandil Alerta</span>
      </p>
      <p className="mt-1">
        Datos informativos, sin garantía. Los precios corresponden a publicaciones oficiales de cada
        supermercado.
      </p>
    </footer>
  );
}
