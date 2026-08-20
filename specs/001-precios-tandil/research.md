# Research: Precios Tandil (Fase 0)

**Date**: 2026-08-20

## Decisiones técnicas

### D1 — Playwright (Node) como motor de scraping base
- **Decisión**: Playwright con Chromium headless para los 6 adaptadores v1.
- **Razón**: Carrefour/Vea/DIA usan anti-bot y contenido dinámico; Playwright
  ejecuta JS real y comparte lenguaje (TS) con API/normalizador/web.
- **Alternativa descartada**: Scrapy/Python por adaptador — se permite como
  excepción puntual si un sitio demuestra mejor rendimiento, vía contrato
  equivalente (Constitución I del stack lo habilita explícitamente).

### D2 — Colas internas con pg-boss en lugar de Redis/BullMQ
- **Decisión**: pg-boss sobre la misma PostgreSQL.
- **Razón**: volumen moderado (~100–500k registros/mes), menos piezas
  operativas, transaccionalidad con datos, reintentos nativos. Redis queda para
  caché de lectura solamente.

### D3 — Particionado mensual + BRIN en price_record
- **Decisión**: `PARTITION BY RANGE (captured_at)` mensual, índice BRIN global
  y btree `(store_sku_id, captured_at DESC)` por partición.
- **Razón**: consultas por ventana temporal y por SKU son los dos patrones
  dominantes; particionado mantiene el tamaño de índices acotado a medida que
  crece el histórico.

### D4 — Matching semántico progresivo
- **Decisión**: v1 = normalización léxica fuerte (unaccent, stopwords,
  unidades, marcas) + trigram/fuzzy scoring determinista. Fase 2 = embeddings
  locales (ONNX) solo si la tasa de match < objetivo SC-003.
- **Razón**: determinismo y auditabilidad primero (Constitución I); embeddings
  agregan opacidad y costo hasta demostrar necesidad.

### D5 — Caché de lectura en dos capas
- **Decisión**: ISR/edge cache en Next.js para páginas públicas + Redis en API
  (search 5 min, history 1 h, product card 5 min) con invalidación por evento
  `aggregates.refreshed`.
- **Razón**: cumple p95 < 200 ms sin sobrecargar PG; precios toleran minutos de
  retardo porque la UI muestra frescura explícita.

### D6 — SEO local
- **Decisión**: Next.js App Router con SSR/ISR (`revalidate` por frescura),
  sitemap dinámico de productos/categorías, JSON-LD `Product`+`Offer`,
  metadatos OG por producto.
- **Razón**: tráfico orgánico local ("precio arroz tandil") es canal primario
  de adquisición junto a Tandil Alerta.

### D7 — Anti-bloqueo
- **Decisión**: pool de proxies residenciales rotativos (config por tienda),
  rotación de User-Agents realistas, delays aleatorios 800–2000 ms, concurrencia
  ≤ 2/sitio, horario nocturno. Sin bypass agresivo de Cloudflare: si un sitio
  bloquea sostenidamente → cuarentena + alerta ops.
- **Razón**: Constitución IX prioriza sostenibilidad legal sobre throughput.

### D8 — Observabilidad
- **Decisión**: pino (logs JSON) → Loki; métricas Prometheus + Grafana;
  alertas a canal de Tandil Alerta/Sigma.
- **Razón**: stack liviano auto-hospedable, correlation-id por corrida.

## Riesgos abiertos

| Riesgo | Mitigación |
|---|---|
| Cambio masivo de DOM en una tienda | Fixtures de regresión + cuarentena + alerta |
| EANs ausentes o erróneos en tiendas | Matching semántico + cola de revisión manual |
| Bloqueo anti-bot sostenido | Proxies residenciales, horarios nocturnos, cuarentena |
| Precios online ≠ sucursal física | Etiqueta clara "precio online" en UI (v1), evolución a por-sucursal |
