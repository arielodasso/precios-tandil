import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = fileURLToPath(new URL('../../apps/web/src', import.meta.url));

function read(relPath: string): string {
  return readFileSync(path.join(WEB_SRC, relPath), 'utf-8');
}

describe('a11y — auditoría estática de componentes (AA)', () => {
  describe('SearchBar', () => {
    const code = read('components/SearchBar.tsx');

    it('tiene role="search" en el contenedor', () => {
      expect(code).toMatch(/role="search"/);
    });

    it('tiene aria-label en el input de búsqueda', () => {
      expect(code).toMatch(/aria-label="Buscar producto"/);
    });

    it('usa role="status" para el estado de loading', () => {
      expect(code).toMatch(/role="status"/);
    });

    it('usa role="alert" para errores', () => {
      expect(code).toMatch(/role="alert"/);
    });

    it('usa <ul> + <li> para la lista de resultados (semántico)', () => {
      expect(code).toMatch(/<ul/);
      expect(code).toMatch(/<li/);
    });
  });

  describe('ProductComparisonCard', () => {
    const code = read('components/ProductComparisonCard.tsx');

    it('usa <section> como contenedor', () => {
      expect(code).toMatch(/<section/);
    });

    it('tiene <h1> para el nombre del producto', () => {
      expect(code).toMatch(/<h1/);
    });

    it('tiene <ul> para la lista de ofertas', () => {
      expect(code).toMatch(/<ul/);
    });

    it('usa <li> con key para cada oferta', () => {
      expect(code).toMatch(/<li[^>]*key=/);
    });
  });

  describe('HistoryStrip', () => {
    const code = read('components/HistoryStrip.tsx');

    it('usa SVG inline para sparkline (no img sin alt)', () => {
      expect(code).toMatch(/<svg/);
    });

    it('no usa <img> sin alt', () => {
      expect(code).not.toMatch(/<img(?![^>]*alt=)[^>]*>/);
    });
  });

  describe('DealBadge', () => {
    const code = read('components/DealBadge.tsx');

    it('usa <span> inline (no div anidado innecesario)', () => {
      expect(code).toMatch(/<span/);
    });
  });

  describe('Home page', () => {
    const code = read('app/page.tsx');

    it('tiene <nav> con aria-label para categorías', () => {
      expect(code).toMatch(/aria-label="Categorías"/);
    });

    it('tiene <h1> principal', () => {
      expect(code).toMatch(/<h1/);
    });

    it('tiene <h2> con id para la sección de deals', () => {
      expect(code).toMatch(/<h2[^>]*id=/);
    });

    it('usa <section> con aria-labelledby para deals', () => {
      expect(code).toMatch(/aria-labelledby="top-deals"/);
    });
  });

  describe('Layout', () => {
    const code = read('app/layout.tsx');

    it('tiene lang="es-AR" en <html>', () => {
      expect(code).toMatch(/lang="es-AR"/);
    });

    it('tiene <header> semántico', () => {
      expect(code).toMatch(/<header/);
    });

    it('tiene <main> semántico', () => {
      expect(code).toMatch(/<main/);
    });

    it('renderiza componente Footer (semántico)', () => {
      expect(code).toMatch(/<Footer \/>/);
    });

    it('tiene <nav> con aria-label para navegación principal', () => {
      expect(code).toMatch(/aria-label="principal"/);
    });
  });

  describe('Product page', () => {
    const code = read('app/p/[slug]/page.tsx');

    it('usa notFound() de Next.js para 404', () => {
      expect(code).toMatch(/notFound\(\)/);
    });

    it('genera JSON-LD con @type Product', () => {
      expect(code).toMatch(/'@type':\s*'Product'/);
    });

    it('usa <script type="application/ld+json">', () => {
      expect(code).toMatch(/type="application\/ld\+json"/);
    });

    it('usa role="status" para stale_notice', () => {
      expect(code).toMatch(/role="status"/);
    });
  });
});
