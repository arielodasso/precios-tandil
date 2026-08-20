<!--
  SYNC IMPACT REPORT
  ==================
  Version change: N/A (initial) → 1.0.0
  Modified principles: N/A (initial ratification)
  Added sections:
    - 9 Core Principles (I–IX)
    - Stack Tecnológico Obligatorio
    - Estándares de Calidad de Datos
    - Flujo de Desarrollo y Quality Gates
    - Governance
  Removed sections: N/A
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ compatible (Constitution Check genérico)
    - .specify/templates/spec-template.md ✅ compatible
    - .specify/templates/tasks-template.md ✅ compatible
  Follow-up TODOs: ninguno
-->

# Precios Tandil Constitution

Motor de análisis y plataforma web de precios de supermercados para Tandil.
Desarrollado junto a **Tandil Alerta**, motorizado por la tecnología **Sigma**.

## Core Principles

### I. Precisión y Veracidad ante Todo

Todo precio mostrado al vecino de Tandil DEBE estar trazable a una fuente
(supermercado + URL del producto) y a una marca de tiempo de captura con
precisión de minutos. Está PROHIBIDO presentar datos desactualizados como
actuales: si la captura supera la ventana de frescura definida (48 h por
defecto), la UI DEBE mostrar explícitamente "última actualización" o degradar
la tarjeta. Un dato dudoso se oculta; nunca se inventa ni se interpola sin
etiquetarlo como estimación. Rationale: la credibilidad del producto y de
Tandil Alerta depende de que cada número sea defendible.

### II. Resiliencia de Ingesta (Tolerancia a Fallos de Scraping)

El sistema asume que TODO scraper fallará eventualmente (Cloudflare, cambio de
DOM, caída del sitio). Ningún fallo de un adaptador puede detener el pipeline
global ni corromper datos existentes. Requisitos no negociables:

- Reintentos con backoff exponencial + jitter (mínimo 3 intentos).
- Rotación de User-Agents y soporte de proxies rotativos.
- Circuit breaker por supermercado: tras N fallos consecutivos el adaptador
  entra en cuarentena y se reintenta en la próxima ventana.
- Cada corrida produce un reporte de ingesta (éxitos, fallos, SKUs omitidos).
- Los precios anteriores permanecen intactos si una captura falla o devuelve
  datos inválidos (validación previa a escritura).

Rationale: la disponibilidad parcial es el estado normal, no la excepción.

### III. Mobile-First Absoluto

El usuario principal está parado en la góndola, con una mano libre, posible
señal 3G/4G inestable, y necesita una respuesta en ≤ 3 segundos. Toda decisión
de diseño e implementación se evalúa primero contra ese escenario:

- Diseño y CSS mobile-first; breakpoints ascendentes como mejora progresiva.
- Objetivos táctiles ≥ 44×44 px; navegación alcanzable con el pulgar.
- Sin interacciones que requieran hover; sin modales bloqueantes para consultar.
- Consultas de comparación deben resolverse en ≤ 2 taps desde la home.

Rationale: si no sirve en la góndola, no sirve.

### IV. Rendimiento Presupuestado

Los presupuestos de rendimiento son requisitos, no aspiraciones:

- API: p95 < 200 ms en consultas de comparación de un producto.
- Web: LCP < 2.5 s en 4G simulada con dispositivo Android gama media;
  INP < 200 ms; CLS < 0.1.
- Bundle JS inicial < 150 KB comprimido para la ruta principal.
- El presupuesto se mide en CI; un PR que lo exceda debe justificarlo o
  revertirse.

Rationale: la velocidad ES la funcionalidad principal del producto.

### V. Historial Inmutable de Precios (Series Temporales)

La tabla de precios es append-only: jamás se actualiza ni borra un registro
histórico. Las variaciones porcentuales diarias/semanales y el "menor precio
histórico" se calculan sobre esa serie inmutable. Correcciones de datos erróneos
se realizan mediante registros de corrección marcados como tales, preservando la
auditoría completa. Rationale: el valor analítico del producto (detectar
subas, oportunidades, tendencias) exige una serie temporal confiable y auditable.

### VI. Accesibilidad y Legibilidad Universal

- Contraste mínimo WCAG 2.1 AA (4.5:1 texto normal; 3:1 texto grande).
- Tipografía de máxima legibilidad (familia tipo Inter/Geist), tamaño base
  móvil ≥ 16 px.
- Soporte obligatorio de modo claro/oscuro respetando `prefers-color-scheme`.
- Navegación completa por teclado y lectores de pantalla en flujos críticos.
- Verde para "mejor precio" siempre acompañado de etiqueta textual, nunca solo
  color (accesibilidad para daltonismo).

### VII. Modularidad por Adaptador

Cada supermercado es un adaptador aislado que implementa un contrato común de
ingesta (`ScraperAdapter`). Un adaptador nuevo o su reemplazo NO puede requerir
modificar otro adaptador ni el núcleo del pipeline. La normalización de SKUs
(EAN-13 cuando existe; similitud semántica de descripciones como fallback) vive
en un módulo independiente y testeable. Rationale: los sitios cambian
constantemente; el acoplamiento convertiría cada cambio de Carrefour en una
caída del sistema completo.

### VIII. Observabilidad Total

Toda ejecución de scraping, normalización y publicación genera logs
estructurados (JSON) con correlation-id de corrida. Métricas mínimas: duración,
SKUs capturados/rechazados, tasa de match EAN, latencia p95 de API. Alertas
obligatorias ante: adaptador en cuarentena > 24 h, tasa de rechazo > 20 %,
brecha de frescura > 72 h en cualquier supermercado.

### IX. Legalidad y Uso Ético de Datos Públicos

La ingesta opera exclusivamente sobre información pública de precios, respeta
`robots.txt` cuando aplica, limita la concurrencia por sitio para no degradar
el servicio del supermercado, y ejecuta las cargas masivas en horarios de bajo
tráfico (00:00–06:00 ART). No se recopilan datos personales de usuarios sin
consentimiento explícito. Rationale: la sostenibilidad legal del proyecto
protege a Tandil Alerta y a Sigma.

## Stack Tecnológico Obligatorio

Las decisiones de stack son parte de la constitución; cambiarlas requiere
enmienda:

- **Ingesta**: Node.js 22 LTS + Playwright (Python + Scrapy permitido por
  adaptador solo si Playwright demuestra rendimiento insuficiente en ese sitio).
- **Normalización**: módulo TypeScript dedicado; matching por EAN-13 primario,
  similitud semántica (normalización léxica + embeddings/fuzzy) secundario.
- **Base de datos**: PostgreSQL 16+ con esquema optimizado para series
  temporales (particionado por rango de fechas en `price_history`, índices
  BRIN/btree según patrón de consulta).
- **API**: Node.js (Fastify) con endpoints REST versionados (`/api/v1/*`),
  autenticación por token para operaciones administrativas, lectura pública
  cacheada (CDN/Redis).
- **Orquestación**: cron jobs en horario de bajo tráfico; colas internas con
  reintentos; idempotencia garantizada por corrida.
- **Frontend**: Next.js (App Router) con SSR/ISR para SEO local, React Server
  Components donde aporte rendimiento, Tailwind CSS.
- **Monorepo**: estructura `apps/web`, `apps/api`, `packages/scraper-core`,
  `packages/adapters/*`, `packages/normalizer`.

## Estándares de Calidad de Datos

- Todo precio pasa validación antes de persistir: valor > 0, moneda ARS,
  formato numérico canónico, URL de fuente válida, timestamp UTC.
- Deduplicación por `(store_sku_id, captured_at_bucket)`; capturas duplicadas
  dentro de la misma corrida se descartan.
- Matching de productos: match automático por EAN-13 exacto; matching semántico
  requiere score ≥ umbral configurado y queda marcado `match_method=semantic`
  para auditoría; los matches dudosos van a cola de revisión manual.
- Métrica de salud de catálogo publicada internamente: % SKUs con EAN,
  % match multi-tienda, % precios frescos.

## Flujo de Desarrollo y Quality Gates

- Metodología Spec Kit (SDD): ninguna feature se implementa sin spec → plan →
  tasks aprobados; los artefactos viven en `specs/<feature>/`.
- Tests obligatorios por capa: unitarios (normalizador, cálculos), de contrato
  (adaptadores contra fixtures HTML congelados), de integración (pipeline → DB),
  E2E (flujos críticos web). Fixtures HTML reales anonimizadas como base de
  regresión de scrapers.
- CI bloquea merge si: tests fallan, presupuestos de rendimiento se exceden,
  lint/typecheck fallan, o cobertura de módulos core (normalizer, price math)
  baja del 90 %.
- Todo PR debe indicar qué principio constitucional podría verse afectado y
  cómo lo preserva.

## Governance

- Esta constitución SUPERSIDE a cualquier otra práctica, documento o decisión
  ad-hoc del proyecto.
- Las enmiendas requieren: documento de propuesta, evaluación de impacto sobre
  specs/planes existentes, actualización de artefactos afectados y registro en
  este archivo con nueva versión semántica (MAJOR: principio eliminado o
  redefinido de forma incompatible; MINOR: nuevo principio o expansión material;
  PATCH: clarificaciones).
- Compliance review: al inicio de cada fase de plan (`/speckit-plan`) se ejecuta
  el Constitution Check; violaciones deben justificarse en Complexity Tracking.
- Guía de desarrollo runtime: `specs/001-precios-tandil/plan.md` y documentos
  derivados.

**Version**: 1.0.0 | **Ratified**: 2026-08-20 | **Last Amended**: 2026-08-20
