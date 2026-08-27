import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Footer } from '@/components/Footer';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Precios Tandil — compará supermercados',
    template: '%s | Precios Tandil',
  },
  description:
    'Compará precios de supermercados de Tandil: Carrefour, Vea, Día, Monarca, Comerciante Maxi y Coto. Historial de precios y oportunidades.',
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
    <html lang="es-AR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.className} min-h-dvh antialiased`}>
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-black text-sm font-black text-alerta">
                T
              </span>
              <span className="text-lg font-extrabold tracking-tight">
                Precios <span className="text-alerta-strong">Tandil</span>
              </span>
            </Link>
            <nav aria-label="principal" className="flex items-center gap-3 text-sm">
              <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
                por Tandil Alerta
              </span>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 pb-16">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
