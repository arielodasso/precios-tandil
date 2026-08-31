import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Footer } from '@/components/Footer';
import './globals.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-montserrat',
});

export const metadata: Metadata = {
  title: {
    default: 'Precios Tandil — compará supermercados',
    template: '%s | Precios Tandil',
  },
  description:
    'Compará precios de supermercados de Tandil: Carrefour, Vea, Día, Monarca, Comerciante Maxi y Coto. Historial de precios y oportunidades.',
  icons: {
    icon: '/sigma-market.png',
    shortcut: '/sigma-market.png',
    apple: '/sigma-market.png',
  },
};

const themeScript = `
(function(){
  var t=localStorage.getItem('theme');
  if(t==='dark'){
    document.documentElement.classList.add('dark');
  }
})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" suppressHydrationWarning className={montserrat.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${montserrat.className} min-h-dvh antialiased`}>
        <header className="border-b border-border bg-background/80 backdrop-blur-sm">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <img
                src="/sigma-market.png"
                alt="Precios Tandil"
                width={36}
                height={36}
                className="h-9 w-9 rounded-lg object-cover"
              />
              <span className="text-lg font-extrabold tracking-tight">
                Precios <span className="text-alerta">Tandil</span>
              </span>
            </Link>
            <nav aria-label="principal" className="flex items-center gap-4 text-sm">
              <Link
                href="/admin/tandilalerta"
                className="hidden font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
              >
                Analíticas
              </Link>
              <span className="hidden items-center gap-1 text-xs font-medium text-muted-foreground sm:inline-flex">
                por{' '}
                <a
                  href="https://sigmatecnologiasarg.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-alerta transition-colors hover:text-alerta-strong"
                >
                  Sigma Tecnologías
                </a>
                <span aria-hidden="true">&amp;</span>
                <a
                  href="https://www.instagram.com/tandilalerta/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-alerta transition-colors hover:text-alerta-strong"
                >
                  Tandil Alerta
                </a>
              </span>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 pb-16 pt-2">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
