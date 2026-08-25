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
  if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)){
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
        <header className="border-b border-black/10 dark:border-white/10">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-bold text-[var(--accent)] text-lg">
              Precios Tandil
            </Link>
            <nav aria-label="principal" className="flex items-center gap-4 text-sm">
              <Link
                href="/ofertas"
                className="hover:text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Ofertas
              </Link>
              <Link
                href="/admin"
                className="hover:text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Admin
              </Link>
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
